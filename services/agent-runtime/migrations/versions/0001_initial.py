"""Initial local-first runtime schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "articles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "artifacts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=100), nullable=False),
        sa.Column("media_type", sa.String(length=200), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_path", sa.String(length=1000), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("content_hash"),
    )
    op.create_index("ix_artifacts_kind", "artifacts", ["kind"], unique=False)
    op.create_index(
        "ix_artifacts_content_hash",
        "artifacts",
        ["content_hash"],
        unique=True,
    )
    op.create_table(
        "article_revisions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("article_id", sa.String(length=36), nullable=False),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("markdown", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("artifact_id", sa.String(length=36), nullable=False),
        sa.Column("parent_revision_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["artifact_id"], ["artifacts.id"]),
        sa.ForeignKeyConstraint(["parent_revision_id"], ["article_revisions.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("article_id", "number", name="uq_revision_number"),
    )
    op.create_index(
        "ix_article_revisions_article_id",
        "article_revisions",
        ["article_id"],
        unique=False,
    )
    op.create_index(
        "ix_article_revisions_content_hash",
        "article_revisions",
        ["content_hash"],
        unique=False,
    )
    op.create_table(
        "workflows",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("version", sa.String(length=50), nullable=False),
        sa.Column("definition_json", sa.JSON(), nullable=False),
        sa.Column("definition_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", "version", name="uq_workflow_name_version"),
    )
    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("workflow_id", sa.String(length=36), nullable=False),
        sa.Column("article_id", sa.String(length=36), nullable=False),
        sa.Column("input_revision_id", sa.String(length=36), nullable=False),
        sa.Column("output_revision_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("approval_status", sa.String(length=50), nullable=False),
        sa.Column("workflow_snapshot_json", sa.JSON(), nullable=False),
        sa.Column("state_json", sa.JSON(), nullable=False),
        sa.Column("interrupt_json", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"]),
        sa.ForeignKeyConstraint(["input_revision_id"], ["article_revisions.id"]),
        sa.ForeignKeyConstraint(["output_revision_id"], ["article_revisions.id"]),
        sa.ForeignKeyConstraint(["workflow_id"], ["workflows.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workflow_runs_article_id",
        "workflow_runs",
        ["article_id"],
        unique=False,
    )
    op.create_index(
        "ix_workflow_runs_status",
        "workflow_runs",
        ["status"],
        unique=False,
    )
    op.create_table(
        "runtime_events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("aggregate_type", sa.String(length=100), nullable=False),
        sa.Column("aggregate_id", sa.String(length=36), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["workflow_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_runtime_events_aggregate_id",
        "runtime_events",
        ["aggregate_id"],
        unique=False,
    )
    op.create_index(
        "ix_runtime_events_event_type",
        "runtime_events",
        ["event_type"],
        unique=False,
    )
    op.create_index(
        "ix_runtime_events_run_id",
        "runtime_events",
        ["run_id"],
        unique=False,
    )
    op.create_table(
        "connection_profiles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("provider", sa.String(length=100), nullable=False),
        sa.Column("base_url", sa.String(length=1000), nullable=True),
        sa.Column("secret_ref", sa.String(length=1000), nullable=False),
        sa.Column("config_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_connection_profiles_provider",
        "connection_profiles",
        ["provider"],
        unique=False,
    )
    op.create_table(
        "platform_variants",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.String(length=36), nullable=False),
        sa.Column("platform", sa.String(length=100), nullable=False),
        sa.Column("account_ref", sa.String(length=300), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("body_artifact_id", sa.String(length=36), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["body_artifact_id"], ["artifacts.id"]),
        sa.ForeignKeyConstraint(["revision_id"], ["article_revisions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_platform_variants_platform",
        "platform_variants",
        ["platform"],
        unique=False,
    )
    op.create_index(
        "ix_platform_variants_revision_id",
        "platform_variants",
        ["revision_id"],
        unique=False,
    )
    op.create_table(
        "publish_plans",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("approval_status", sa.String(length=50), nullable=False),
        sa.Column("plan_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["article_revisions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_publish_plans_revision_id",
        "publish_plans",
        ["revision_id"],
        unique=False,
    )
    op.create_index(
        "ix_publish_plans_status",
        "publish_plans",
        ["status"],
        unique=False,
    )
    op.create_table(
        "publish_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("plan_id", sa.String(length=36), nullable=False),
        sa.Column("variant_id", sa.String(length=36), nullable=False),
        sa.Column("connection_profile_id", sa.String(length=36), nullable=True),
        sa.Column("platform", sa.String(length=100), nullable=False),
        sa.Column("account_ref", sa.String(length=300), nullable=False),
        sa.Column("operation", sa.String(length=50), nullable=False),
        sa.Column("idempotency_key", sa.String(length=64), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("remote_id", sa.String(length=500), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("reconcile_required", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["connection_profile_id"],
            ["connection_profiles.id"],
        ),
        sa.ForeignKeyConstraint(["plan_id"], ["publish_plans.id"]),
        sa.ForeignKeyConstraint(["variant_id"], ["platform_variants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index(
        "ix_publish_jobs_idempotency_key",
        "publish_jobs",
        ["idempotency_key"],
        unique=True,
    )
    op.create_index(
        "ix_publish_jobs_plan_id",
        "publish_jobs",
        ["plan_id"],
        unique=False,
    )
    op.create_index(
        "ix_publish_jobs_platform",
        "publish_jobs",
        ["platform"],
        unique=False,
    )
    op.create_index(
        "ix_publish_jobs_state",
        "publish_jobs",
        ["state"],
        unique=False,
    )
    op.create_table(
        "publish_attempts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("job_id", sa.String(length=36), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("operation", sa.String(length=50), nullable=False),
        sa.Column("state", sa.String(length=50), nullable=False),
        sa.Column("request_json", sa.JSON(), nullable=False),
        sa.Column("response_json", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["job_id"], ["publish_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "attempt_number", name="uq_attempt_number"),
    )
    op.create_index(
        "ix_publish_attempts_job_id",
        "publish_attempts",
        ["job_id"],
        unique=False,
    )
    op.create_table(
        "publish_receipts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("job_id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=100), nullable=False),
        sa.Column("remote_id", sa.String(length=500), nullable=False),
        sa.Column("remote_url", sa.String(length=1000), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("details_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["publish_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id"),
    )
    op.create_index(
        "ix_publish_receipts_job_id",
        "publish_receipts",
        ["job_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_table("publish_receipts")
    op.drop_table("publish_attempts")
    op.drop_table("publish_jobs")
    op.drop_table("publish_plans")
    op.drop_table("platform_variants")
    op.drop_table("connection_profiles")
    op.drop_table("runtime_events")
    op.drop_table("workflow_runs")
    op.drop_table("workflows")
    op.drop_table("article_revisions")
    op.drop_table("artifacts")
    op.drop_table("articles")
