from __future__ import annotations

from typing import Any

from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.entities import Article, ArticleRevision, utc_now


class ArticleService:
    def __init__(
        self,
        repository: RuntimeRepository,
        artifact_service: ArtifactService,
    ) -> None:
        self.repository = repository
        self.artifact_service = artifact_service

    def create_article(
        self,
        *,
        title: str,
        markdown: str,
        metadata: dict[str, Any] | None = None,
    ) -> tuple[Article, ArticleRevision]:
        title = title.strip()
        if not title:
            raise ValueError("article title cannot be empty")
        article = self.repository.add_article(
            Article(title=title, metadata_json=metadata or {})
        )
        revision = self.create_revision(article_id=article.id, markdown=markdown)
        return article, revision

    def create_revision(
        self,
        *,
        article_id: str,
        markdown: str,
        parent_revision_id: str | None = None,
    ) -> ArticleRevision:
        article = self.repository.get_article(article_id)
        if article is None:
            raise LookupError(f"article {article_id} not found")
        normalized_markdown = markdown.replace("\r\n", "\n").strip()
        if not normalized_markdown:
            raise ValueError("canonical Markdown cannot be empty")

        artifact = self.artifact_service.put_text(
            kind="article.markdown",
            text=normalized_markdown,
            media_type="text/markdown; charset=utf-8",
            metadata={"article_id": article_id},
        )
        latest = self.repository.get_latest_revision(article_id)
        if latest and latest.content_hash == artifact.content_hash:
            return latest
        if parent_revision_id is None and latest:
            parent_revision_id = latest.id
        revision = ArticleRevision(
            article_id=article_id,
            number=self.repository.next_revision_number(article_id),
            markdown=normalized_markdown,
            content_hash=artifact.content_hash,
            artifact_id=artifact.id,
            parent_revision_id=parent_revision_id,
        )
        article.updated_at = utc_now()
        return self.repository.add_revision(revision)

    def get_article_with_latest_revision(
        self, article_id: str
    ) -> tuple[Article, ArticleRevision]:
        article = self.repository.get_article(article_id)
        if article is None:
            raise LookupError(f"article {article_id} not found")
        revision = self.repository.get_latest_revision(article_id)
        if revision is None:
            raise LookupError(f"article {article_id} has no revisions")
        return article, revision

