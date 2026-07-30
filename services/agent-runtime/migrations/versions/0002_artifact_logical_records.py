"""Allow logical Artifact records to share one content-addressed blob.

Revision ID: 0002_artifact_logical_records
Revises: 0001_initial
Create Date: 2026-07-30
"""

from __future__ import annotations

from alembic import op

revision: str = "0002_artifact_logical_records"
down_revision: str | None = "0001_initial"
branch_labels: str | None = None
depends_on: str | None = None

NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
}


def upgrade() -> None:
    with op.batch_alter_table(
        "artifacts",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_index("ix_artifacts_content_hash")
        batch_op.drop_constraint(
            "uq_artifacts_content_hash",
            type_="unique",
        )
        batch_op.create_index(
            "ix_artifacts_content_hash",
            ["content_hash"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table(
        "artifacts",
        naming_convention=NAMING_CONVENTION,
    ) as batch_op:
        batch_op.drop_index("ix_artifacts_content_hash")
        batch_op.create_unique_constraint(
            "uq_artifacts_content_hash",
            ["content_hash"],
        )
        batch_op.create_index(
            "ix_artifacts_content_hash",
            ["content_hash"],
            unique=True,
        )
