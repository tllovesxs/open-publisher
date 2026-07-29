from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class ArticleORM(Base):
    __tablename__ = "articles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ArtifactORM(Base):
    __tablename__ = "artifacts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    kind: Mapped[str] = mapped_column(String(100), index=True)
    media_type: Mapped[str] = mapped_column(String(200))
    content_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    storage_path: Mapped[str] = mapped_column(String(1000))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ArticleRevisionORM(Base):
    __tablename__ = "article_revisions"
    __table_args__ = (UniqueConstraint("article_id", "number", name="uq_revision_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    article_id: Mapped[str] = mapped_column(
        ForeignKey("articles.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[int] = mapped_column(Integer)
    markdown: Mapped[str] = mapped_column(Text)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    parent_revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("article_revisions.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class WorkflowORM(Base):
    __tablename__ = "workflows"
    __table_args__ = (UniqueConstraint("name", "version", name="uq_workflow_name_version"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[str] = mapped_column(String(50))
    definition_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    definition_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class WorkflowRunORM(Base):
    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(ForeignKey("workflows.id"))
    article_id: Mapped[str] = mapped_column(ForeignKey("articles.id"), index=True)
    input_revision_id: Mapped[str] = mapped_column(ForeignKey("article_revisions.id"))
    output_revision_id: Mapped[str | None] = mapped_column(
        ForeignKey("article_revisions.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(50), index=True)
    approval_status: Mapped[str] = mapped_column(String(50))
    workflow_snapshot_json: Mapped[dict[str, Any]] = mapped_column(JSON)
    state_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    interrupt_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RuntimeEventORM(Base):
    __tablename__ = "runtime_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str | None] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="CASCADE"), nullable=True, index=True
    )
    aggregate_type: Mapped[str] = mapped_column(String(100))
    aggregate_id: Mapped[str] = mapped_column(String(36), index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class ConnectionProfileORM(Base):
    __tablename__ = "connection_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    provider: Mapped[str] = mapped_column(String(100), index=True)
    base_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    secret_ref: Mapped[str] = mapped_column(String(1000))
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PlatformVariantORM(Base):
    __tablename__ = "platform_variants"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("article_revisions.id"), index=True)
    platform: Mapped[str] = mapped_column(String(100), index=True)
    account_ref: Mapped[str] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(500))
    body_artifact_id: Mapped[str] = mapped_column(ForeignKey("artifacts.id"))
    content_hash: Mapped[str] = mapped_column(String(64))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PublishPlanORM(Base):
    __tablename__ = "publish_plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    revision_id: Mapped[str] = mapped_column(ForeignKey("article_revisions.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), index=True)
    approval_status: Mapped[str] = mapped_column(String(50))
    plan_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PublishJobORM(Base):
    __tablename__ = "publish_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    plan_id: Mapped[str] = mapped_column(ForeignKey("publish_plans.id"), index=True)
    variant_id: Mapped[str] = mapped_column(ForeignKey("platform_variants.id"))
    connection_profile_id: Mapped[str | None] = mapped_column(
        ForeignKey("connection_profiles.id"), nullable=True
    )
    platform: Mapped[str] = mapped_column(String(100), index=True)
    account_ref: Mapped[str] = mapped_column(String(300))
    operation: Mapped[str] = mapped_column(String(50))
    idempotency_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    payload_hash: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    state: Mapped[str] = mapped_column(String(50), index=True)
    remote_id: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    reconcile_required: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class PublishAttemptORM(Base):
    __tablename__ = "publish_attempts"
    __table_args__ = (UniqueConstraint("job_id", "attempt_number", name="uq_attempt_number"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("publish_jobs.id", ondelete="CASCADE"), index=True
    )
    attempt_number: Mapped[int] = mapped_column(Integer)
    operation: Mapped[str] = mapped_column(String(50))
    state: Mapped[str] = mapped_column(String(50))
    request_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    response_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PublishReceiptORM(Base):
    __tablename__ = "publish_receipts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("publish_jobs.id", ondelete="CASCADE"), unique=True, index=True
    )
    status: Mapped[str] = mapped_column(String(100))
    remote_id: Mapped[str] = mapped_column(String(500))
    remote_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    content_hash: Mapped[str] = mapped_column(String(64))
    details_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

