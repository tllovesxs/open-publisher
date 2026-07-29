"""Initial local-first runtime schema.

Revision ID: 0001_initial
Revises:
Create Date: 2026-07-30
"""

from __future__ import annotations

from alembic import op

from open_publisher_runtime.infrastructure.orm import Base

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    # The immutable ORM metadata is the source for this initial baseline. Future
    # revisions must use explicit, incremental Alembic operations.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())

