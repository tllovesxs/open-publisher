from pathlib import Path

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

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
