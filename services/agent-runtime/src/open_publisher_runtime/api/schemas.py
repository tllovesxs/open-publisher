from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator

from open_publisher_runtime.application.batch_generation import BatchTopicCandidate
from open_publisher_runtime.application.platform_adapters import (
    CapabilityReport,
    PlatformName,
)
from open_publisher_runtime.domain.contracts import ContentPackageV1
from open_publisher_runtime.domain.entities import (
    Article,
    ArticleRevision,
    Artifact,
    ConnectionProfile,
    GenerationBatch,
    GenerationItem,
    PlatformVariant,
    PublishJob,
    PublishPlan,
    PublishReceipt,
    RuntimeEvent,
    Workflow,
    WorkflowRun,
)
from open_publisher_runtime.domain.policies import RunPolicy


class ApiModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HealthResponse(ApiModel):
    status: Literal["ok"]
    database: Literal["ok"]
    publisher_mode: Literal["dry_run"]


class VersionResponse(ApiModel):
    name: str
    version: str
    api_version: Literal["v1"]
    python: str
    langgraph_available: bool
    remote_publish_enabled: Literal[False] = False


class ModelTestRequest(ApiModel):
    pass


class ModelTestResponse(ApiModel):
    provider: str
    model: str
    mocked: bool


class TemplateExtractionRequest(ApiModel):
    source_markdown: str = Field(min_length=1, max_length=60_000)

    @field_validator("source_markdown")
    @classmethod
    def validate_source_markdown_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("source markdown cannot be blank")
        if "\x00" in value:
            raise ValueError("source markdown contains an unsupported control character")
        return value


class TemplateExtractionResponse(ApiModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=300)
    category: str = Field(min_length=1, max_length=60)
    markdown: str = Field(min_length=1, max_length=32_768)
    provider: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)
    mocked: bool


class CreateArticleRequest(ApiModel):
    title: str = Field(min_length=1, max_length=500)
    markdown: str = Field(min_length=1)
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreateRevisionRequest(ApiModel):
    markdown: str = Field(min_length=1)
    parent_revision_id: str | None = None


class ArticleWithRevision(ApiModel):
    article: Article
    revision: ArticleRevision


class ArticleDetail(ApiModel):
    article: Article
    latest_revision: ArticleRevision
    revisions: list[ArticleRevision]


class CreateRunRequest(ApiModel):
    workflow_id: str
    article_id: str
    revision_id: str
    topic: str | None = None
    policy: RunPolicy = Field(default_factory=RunPolicy)


class BatchTopicPlanRequest(ApiModel):
    prompt: str = Field(min_length=1, max_length=6_000)
    count: int = Field(default=3, ge=1, le=10)
    references: str = Field(default="", max_length=60_000)
    manual_topics: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("manual_topics")
    @classmethod
    def validate_manual_topics(cls, value: list[str]) -> list[str]:
        normalized = [topic.strip() for topic in value if topic.strip()]
        if len(normalized) != len(value) or len(set(normalized)) != len(normalized):
            raise ValueError("manual_topics must be non-blank and unique")
        return normalized


class BatchTopicPlanResponse(ApiModel):
    candidates: list[BatchTopicCandidate]
    planned_by: Literal["model", "manual"]


class CreateGenerationBatchRequest(ApiModel):
    prompt: str = Field(min_length=1, max_length=6_000)
    candidates: list[BatchTopicCandidate] = Field(min_length=1, max_length=10)
    source_markdown: str = Field(default="", max_length=80_000)
    policy: RunPolicy = Field(default_factory=RunPolicy)
    writer_concurrency: int = Field(default=2, ge=1, le=4)


class GenerationBatchDetail(ApiModel):
    batch: GenerationBatch
    items: list[GenerationItem]


class ResumeRunRequest(ApiModel):
    action: Literal["approve", "reject"]
    comment: str | None = Field(default=None, max_length=2000)


class RunDetail(ApiModel):
    run: WorkflowRun
    events: list[RuntimeEvent]


class CreateConnectionProfileRequest(ApiModel):
    name: str = Field(min_length=1, max_length=200)
    provider: str = Field(min_length=1, max_length=100)
    base_url: str | None = None
    secret_ref: str = Field(min_length=1, max_length=1000)
    config: dict[str, Any] = Field(default_factory=dict)


class ConnectionProfilePublic(ApiModel):
    id: str
    name: str
    provider: str
    base_url: str | None = None
    config_json: dict[str, Any] = Field(default_factory=dict)
    secret_scheme: str
    secret_configured: Literal[True] = True
    created_at: datetime

    @classmethod
    def from_profile(cls, profile: ConnectionProfile) -> ConnectionProfilePublic:
        return cls(
            id=profile.id,
            name=profile.name,
            provider=profile.provider,
            base_url=profile.base_url,
            config_json=profile.config_json,
            secret_scheme=urlparse(profile.secret_ref).scheme,
            created_at=profile.created_at,
        )


class ArtifactPublic(ApiModel):
    id: str
    kind: str
    media_type: str
    content_hash: str
    size_bytes: int
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime

    @classmethod
    def from_artifact(cls, artifact: Artifact) -> ArtifactPublic:
        return cls(
            id=artifact.id,
            kind=artifact.kind,
            media_type=artifact.media_type,
            content_hash=artifact.content_hash,
            size_bytes=artifact.size_bytes,
            metadata_json=artifact.metadata_json,
            created_at=artifact.created_at,
        )


class GeneratedImageArtifactPublic(ArtifactPublic):
    """A generated image that the desktop can immediately add to its local library."""

    content_base64: str = Field(min_length=4, max_length=14_000_000)

    @classmethod
    def from_artifact_with_content(
        cls,
        artifact: Artifact,
        *,
        content_base64: str,
    ) -> GeneratedImageArtifactPublic:
        return cls(
            **ArtifactPublic.from_artifact(artifact).model_dump(),
            content_base64=content_base64,
        )


class GenerateImagesRequest(ApiModel):
    prompt: str = Field(min_length=1, max_length=4000)
    size: Literal[
        "512x512",
        "768x768",
        "1024x1024",
        "1024x1536",
        "1536x1024",
    ] = "1024x1024"
    model: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("prompt")
    @classmethod
    def validate_prompt_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("image prompt cannot be blank")
        return value


class GenerateImagesResponse(ApiModel):
    provider: str
    model: str
    mocked: bool
    artifacts: list[GeneratedImageArtifactPublic]
    remote_urls_ignored: int = Field(ge=0)


class PlatformCapabilitySummary(ApiModel):
    platform: PlatformName
    reports: list[CapabilityReport]
    fallback_selected: Literal[False] = False


class PlatformCapabilitiesResponse(ApiModel):
    evaluation: Literal["static_offline"] = "static_offline"
    platforms: list[PlatformCapabilitySummary]
    network_probe_performed: Literal[False] = False
    remote_write_performed: Literal[False] = False


class PublishTargetRequest(ApiModel):
    platform: str = Field(min_length=1, max_length=100)
    account_ref: str = Field(min_length=1, max_length=300)
    connection_profile_id: str | None = None
    title: str | None = Field(default=None, max_length=500)
    metadata: dict[str, object] = Field(default_factory=dict)
    simulate_outcome: Literal[
        "success",
        "unknown",
        "unknown_then_success",
        "retryable_failure",
        "terminal_failure",
    ] = "success"


class CreatePublishPlanRequest(ApiModel):
    revision_id: str
    targets: list[PublishTargetRequest] = Field(min_length=1)
    selected_asset_ids: list[str] = Field(default_factory=list, max_length=32)

    @field_validator("selected_asset_ids")
    @classmethod
    def validate_unique_selected_asset_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("selected_asset_ids must not contain duplicates")
        if any(not asset_id.strip() for asset_id in value):
            raise ValueError("selected_asset_ids cannot contain blank values")
        return value


class ApprovePublishPlanRequest(ApiModel):
    actor_id: str = Field(default="user:local", min_length=1, max_length=200)
    comment: str | None = Field(default=None, max_length=2000)


class PublishPlanDetail(ApiModel):
    plan: PublishPlan
    variants: list[PlatformVariant]
    jobs: list[PublishJob] = Field(default_factory=list)


class EnqueueResponse(ApiModel):
    plan: PublishPlan
    jobs: list[PublishJob]


class ProcessJobResponse(ApiModel):
    job: PublishJob
    receipt: PublishReceipt | None = None


class ExportContentPackageRequest(ApiModel):
    article_id: str
    revision_id: str | None = None
    artifact_ids: list[str] = Field(default_factory=list, max_length=64)
    platform_variant_ids: list[str] = Field(default_factory=list, max_length=32)


class ImportContentPackageResponse(ApiModel):
    article: Article
    revision: ArticleRevision
    imported_artifacts: list[Artifact]


class DemoRequest(ApiModel):
    title: str = Field(default="Open Publisher 演示文章", min_length=1, max_length=500)
    topic: str = Field(default="本地优先的智能写作与发布", min_length=1)
    source_markdown: str = Field(
        default="这是一段由用户提供的原始素材，运行时将基于它创建不可变修订。"
    )
    platforms: list[str] = Field(default_factory=lambda: ["csdn", "wechat", "toutiao"])
    disabled_optional_node_ids: list[
        Literal["research", "outline", "natural-style", "review", "visual"]
    ] = Field(default_factory=list, max_length=5)

    @field_validator("disabled_optional_node_ids")
    @classmethod
    def validate_unique_disabled_nodes(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("disabled_optional_node_ids must not contain duplicates")
        return value


class DemoResponse(ApiModel):
    article: Article
    input_revision: ArticleRevision
    run: WorkflowRun
    output_revision: ArticleRevision
    plan: PublishPlan
    variants: list[PlatformVariant]
    jobs: list[PublishJob]
    receipts: list[PublishReceipt]
    content_package: ContentPackageV1


class RuntimeCatalog(ApiModel):
    workflows: list[Workflow]
    connections: list[ConnectionProfilePublic]
