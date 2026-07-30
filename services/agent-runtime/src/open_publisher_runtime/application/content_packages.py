from __future__ import annotations

import base64
import binascii
import mimetypes

from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.contracts import (
    MAX_CONTENT_PACKAGE_ASSET_BYTES,
    MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES,
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
        platform_variant_ids: list[str] | None = None,
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
        variant_ids = platform_variant_ids or []
        if len(variant_ids) != len(set(variant_ids)):
            raise ValueError("platform variant ids must be unique")
        for variant_id in variant_ids:
            variant = self.repository.get_variant(variant_id)
            if variant is None or variant.revision_id != revision.id:
                raise LookupError(
                    "platform variant does not belong to the requested revision"
                )

        assets: list[ContentPackageAssetV1] = []
        for artifact_id in artifact_ids or []:
            artifact = self.repository.get_artifact(artifact_id)
            if artifact is None:
                raise LookupError(f"artifact {artifact_id} not found")
            data = self.artifact_service.read_bytes(artifact.id)
            media_type = artifact.media_type.split(";", maxsplit=1)[0].strip().lower()
            extension = mimetypes.guess_extension(media_type) or ""
            if extension == ".jpe":
                extension = ".jpg"
            assets.append(
                ContentPackageAssetV1(
                    path=f"assets/{artifact.content_hash}{extension}",
                    kind=artifact.kind,
                    media_type=artifact.media_type,
                    content_base64=base64.b64encode(data).decode("ascii"),
                    content_hash=artifact.content_hash,
                    metadata={
                        **artifact.metadata_json,
                        "artifact_id": artifact.id,
                    },
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
                "platform_variant_ids": variant_ids,
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

        validated_assets: list[tuple[ContentPackageAssetV1, bytes]] = []
        total_asset_bytes = 0
        for asset in package.assets:
            try:
                data = base64.b64decode(asset.content_base64, validate=True)
            except (binascii.Error, ValueError) as error:
                raise ValueError(f"invalid base64 for asset {asset.path}") from error
            if len(data) > MAX_CONTENT_PACKAGE_ASSET_BYTES:
                raise ValueError(f"ContentPackage asset exceeds size limit: {asset.path}")
            total_asset_bytes += len(data)
            if total_asset_bytes > MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES:
                raise ValueError("ContentPackage assets exceed the total size limit")
            if self.artifact_service.digest(data) != asset.content_hash:
                raise ValueError(f"ContentPackage asset hash mismatch: {asset.path}")
            validated_assets.append((asset, data))

        # Do not write any blob until every path, base64 payload, size, and hash is valid.
        imported_artifacts: list[Artifact] = []
        for asset, data in validated_assets:
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
