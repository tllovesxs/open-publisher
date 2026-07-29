from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

from open_publisher_runtime.domain.enums import (
    ApprovalStatus,
    PublishAttemptState,
    PublishJobState,
    PublishOperation,
    PublishPlanStatus,
    RunStatus,
)


def new_id() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(UTC)


class DomainModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")


class Article(DomainModel):
    id: str = Field(default_factory=new_id)
    title: str
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class ArticleRevision(DomainModel):
    id: str = Field(default_factory=new_id)
    article_id: str
    number: int
    markdown: str
    content_hash: str
    artifact_id: str
    parent_revision_id: str | None = None
    created_at: datetime = Field(default_factory=utc_now)


class Artifact(DomainModel):
    id: str = Field(default_factory=new_id)
    kind: str
    media_type: str
    content_hash: str
    size_bytes: int
    storage_path: str
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class Workflow(DomainModel):
    id: str = Field(default_factory=new_id)
    name: str
    version: str
    definition_json: dict[str, Any]
    definition_hash: str
    created_at: datetime = Field(default_factory=utc_now)


class WorkflowRun(DomainModel):
    id: str = Field(default_factory=new_id)
    workflow_id: str
    article_id: str
    input_revision_id: str
    output_revision_id: str | None = None
    status: RunStatus = RunStatus.QUEUED
    approval_status: ApprovalStatus = ApprovalStatus.NOT_REQUIRED
    workflow_snapshot_json: dict[str, Any]
    state_json: dict[str, Any] = Field(default_factory=dict)
    interrupt_json: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime = Field(default_factory=utc_now)
    started_at: datetime | None = None
    completed_at: datetime | None = None


class RuntimeEvent(DomainModel):
    id: str = Field(default_factory=new_id)
    run_id: str | None = None
    aggregate_type: str
    aggregate_id: str
    event_type: str
    payload_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class ConnectionProfile(DomainModel):
    id: str = Field(default_factory=new_id)
    name: str
    provider: str
    base_url: str | None = None
    secret_ref: str
    config_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class PlatformVariant(DomainModel):
    id: str = Field(default_factory=new_id)
    revision_id: str
    platform: str
    account_ref: str
    title: str
    body_artifact_id: str
    content_hash: str
    metadata_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)


class PublishPlan(DomainModel):
    id: str = Field(default_factory=new_id)
    revision_id: str
    status: PublishPlanStatus = PublishPlanStatus.DRAFT
    approval_status: ApprovalStatus = ApprovalStatus.PENDING
    plan_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class PublishJob(DomainModel):
    id: str = Field(default_factory=new_id)
    plan_id: str
    variant_id: str
    connection_profile_id: str | None = None
    platform: str
    account_ref: str
    operation: PublishOperation = PublishOperation.DRY_RUN
    idempotency_key: str
    payload_hash: str
    payload_json: dict[str, Any] = Field(default_factory=dict)
    state: PublishJobState = PublishJobState.PENDING
    remote_id: str | None = None
    last_error: str | None = None
    reconcile_required: bool = False
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)


class PublishAttempt(DomainModel):
    id: str = Field(default_factory=new_id)
    job_id: str
    attempt_number: int
    operation: PublishOperation
    state: PublishAttemptState = PublishAttemptState.IN_PROGRESS
    request_json: dict[str, Any] = Field(default_factory=dict)
    response_json: dict[str, Any] = Field(default_factory=dict)
    error: str | None = None
    started_at: datetime = Field(default_factory=utc_now)
    completed_at: datetime | None = None


class PublishReceipt(DomainModel):
    id: str = Field(default_factory=new_id)
    job_id: str
    status: str
    remote_id: str
    remote_url: str | None = None
    content_hash: str
    details_json: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=utc_now)

