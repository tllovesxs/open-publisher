"""Persist generation batch queue records.

Revision ID: 0003_generation_batches
Revises: 0002_artifact_logical_records
Create Date: 2026-08-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = "0003_generation_batches"
down_revision: str | None = "0002_artifact_logical_records"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "generation_batches",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("policy_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("writer_concurrency", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_generation_batches_status",
        "generation_batches",
        ["status"],
        unique=False,
    )
    op.create_table(
        "generation_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("batch_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("topic", sa.Text(), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("article_id", sa.String(length=36), nullable=True),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["article_id"], ["articles.id"]),
        sa.ForeignKeyConstraint(["batch_id"], ["generation_batches.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["workflow_runs.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("batch_id", "position", name="uq_generation_item_position"),
    )
    op.create_index(
        "ix_generation_items_batch_id",
        "generation_items",
        ["batch_id"],
        unique=False,
    )
    op.create_index(
        "ix_generation_items_status",
        "generation_items",
        ["status"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_generation_items_status", table_name="generation_items")
    op.drop_index("ix_generation_items_batch_id", table_name="generation_items")
    op.drop_table("generation_items")
    op.drop_index("ix_generation_batches_status", table_name="generation_batches")
    op.drop_table("generation_batches")
