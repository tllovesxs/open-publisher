from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect, text

from open_publisher_runtime.infrastructure.orm import Base


def test_alembic_initial_schema(tmp_path) -> None:
    runtime_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "migration.db"
    config = Config(str(runtime_root / "alembic.ini"))
    config.set_main_option("script_location", str(runtime_root / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path.as_posix()}")

    command.upgrade(config, "head")

    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    tables = set(inspect(engine).get_table_names())
    assert {
        "alembic_version",
        "article_revisions",
        "articles",
        "artifacts",
        "publish_attempts",
        "publish_jobs",
        "publish_plans",
        "publish_receipts",
        "workflow_runs",
        "workflows",
    } <= tables

    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    engine.dispose()

    command.downgrade(config, "base")
    downgraded_engine = create_engine(config.get_main_option("sqlalchemy.url"))
    assert set(inspect(downgraded_engine).get_table_names()) == {"alembic_version"}
    downgraded_engine.dispose()


def test_artifact_migration_preserves_blobs_and_allows_logical_duplicates(
    tmp_path,
) -> None:
    runtime_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "artifact-migration.db"
    config = Config(str(runtime_root / "alembic.ini"))
    config.set_main_option("script_location", str(runtime_root / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path.as_posix()}")
    command.upgrade(config, "0001_initial")

    content_hash = "a" * 64
    engine = create_engine(config.get_main_option("sqlalchemy.url"))
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO artifacts (
                    id, kind, media_type, content_hash, size_bytes,
                    storage_path, metadata_json, created_at
                ) VALUES (
                    :id, :kind, :media_type, :content_hash, :size_bytes,
                    :storage_path, :metadata_json, CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "id": "artifact-before-migration",
                "kind": "workflow.review-report",
                "media_type": "text/plain",
                "content_hash": content_hash,
                "size_bytes": 4,
                "storage_path": f"sha256/aa/aa/{content_hash}",
                "metadata_json": "{}",
            },
        )
    engine.dispose()

    command.upgrade(config, "head")
    migrated_engine = create_engine(config.get_main_option("sqlalchemy.url"))
    with migrated_engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO artifacts (
                    id, kind, media_type, content_hash, size_bytes,
                    storage_path, metadata_json, created_at
                ) VALUES (
                    :id, :kind, :media_type, :content_hash, :size_bytes,
                    :storage_path, :metadata_json, CURRENT_TIMESTAMP
                )
                """
            ),
            {
                "id": "artifact-after-migration",
                "kind": "workflow.risk-report",
                "media_type": "text/plain",
                "content_hash": content_hash,
                "size_bytes": 4,
                "storage_path": f"sha256/aa/aa/{content_hash}",
                "metadata_json": "{}",
            },
        )
        count = connection.scalar(
            text("SELECT COUNT(*) FROM artifacts WHERE content_hash = :content_hash"),
            {"content_hash": content_hash},
        )
        assert count == 2
        connection.execute(text("DELETE FROM artifacts"))
    migrated_engine.dispose()

    command.downgrade(config, "base")
