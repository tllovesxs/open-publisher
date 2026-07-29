from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def test_alembic_initial_schema(tmp_path) -> None:
    runtime_root = Path(__file__).resolve().parents[1]
    database_path = tmp_path / "migration.db"
    config = Config(str(runtime_root / "alembic.ini"))
    config.set_main_option("script_location", str(runtime_root / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database_path.as_posix()}")

    command.upgrade(config, "head")

    tables = set(inspect(create_engine(config.get_main_option("sqlalchemy.url"))).get_table_names())
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

