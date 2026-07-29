from __future__ import annotations

import base64
import binascii

from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.contracts import (
    ContentPackageArticleV1,
    ContentPackageAssetV1,
    ContentPackageV1,
)
from open_publisher_runtime.domain.entities import Article, ArticleRevision, Artifact


class ContentPackageService:
    def __init__(
        self,
        repository: RuntimeRepository,
        artifact_service: ArtifactService,
        article_service: ArticleService,
    ) -> None:
        self.repository = repository
        self.artifact_service = artifact_service
        self.article_service = article_service

    def export(
        self,
        *,
        article_id: str,
        revision_id: str | None = None,
        artifact_ids: list[str] | None = None,
    ) -> ContentPackageV1:
        article = self.repository.get_article(article_id)
        if article is None:
            raise LookupError(f"article {article_id} not found")
        revision = (
            self.repository.get_revision(revision_id)
            if revision_id
            else self.repository.get_latest_revision(article_id)
        )
        if revision is None or revision.article_id != article_id:
            raise LookupError("revision does not belong to the requested article")

        assets: list[ContentPackageAssetV1] = []
        for artifact_id in artifact_ids or []:
            artifact = self.repository.get_artifact(artifact_id)
            if artifact is None:
                raise LookupError(f"artifact {artifact_id} not found")
            data = self.artifact_service.read_bytes(artifact.id)
            assets.append(
                ContentPackageAssetV1(
                    path=f"assets/{artifact.content_hash}",
                    kind=artifact.kind,
                    media_type=artifact.media_type,
                    content_base64=base64.b64encode(data).decode("ascii"),
                    content_hash=artifact.content_hash,
                    metadata=artifact.metadata_json,
                )
            )

        return ContentPackageV1(
            article=ContentPackageArticleV1(
                title=article.title,
                revision_number=revision.number,
                canonical_markdown=revision.markdown,
                content_hash=revision.content_hash,
            ),
            assets=assets,
            metadata={
                "article_id": article.id,
                "revision_id": revision.id,
            },
        )

    def import_package(
        self, package: ContentPackageV1
    ) -> tuple[Article, ArticleRevision, list[Artifact]]:
        markdown_bytes = package.article.canonical_markdown.replace("\r\n", "\n").strip().encode(
            "utf-8"
        )
        actual_markdown_hash = self.artifact_service.digest(markdown_bytes)
        if actual_markdown_hash != package.article.content_hash:
            raise ValueError("ContentPackage canonical Markdown hash mismatch")

        imported_artifacts: list[Artifact] = []
        for asset in package.assets:
            try:
                data = base64.b64decode(asset.content_base64, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError(f"invalid base64 for asset {asset.path}") from error
            if self.artifact_service.digest(data) != asset.content_hash:
                raise ValueError(f"ContentPackage asset hash mismatch: {asset.path}")
            imported_artifacts.append(
                self.artifact_service.put_bytes(
                    kind=asset.kind,
                    media_type=asset.media_type,
                    data=data,
                    metadata={
                        **asset.metadata,
                        "content_package_id": package.package_id,
                        "original_path": asset.path,
                    },
                )
            )

        article, revision = self.article_service.create_article(
            title=package.article.title,
            markdown=package.article.canonical_markdown,
            metadata={
                "imported_from": package.source_app,
                "content_package_id": package.package_id,
            },
        )
        return article, revision, imported_artifacts

