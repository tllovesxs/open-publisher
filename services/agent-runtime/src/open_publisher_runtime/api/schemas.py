from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from open_publisher_runtime.domain.contracts import ContentPackageV1
from open_publisher_runtime.domain.entities import (
    Article,
    ArticleRevision,
    Artifact,
    ConnectionProfile,
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
    approved: bool = True


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
    artifact_ids: list[str] = Field(default_factory=list)


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
    connections: list[ConnectionProfile]

