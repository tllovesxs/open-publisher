from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from sqlalchemy import text

from open_publisher_runtime import __version__
from open_publisher_runtime.api.dependencies import RuntimeContainer
from open_publisher_runtime.api.routes import router
from open_publisher_runtime.api.schemas import HealthResponse
from open_publisher_runtime.application.harness import WorkflowService
from open_publisher_runtime.application.model_access import ModelAccessLayer
from open_publisher_runtime.application.publishing import DeterministicDryRunPublisher
from open_publisher_runtime.config import Settings
from open_publisher_runtime.infrastructure.artifact_store import FileSystemArtifactStore
from open_publisher_runtime.infrastructure.database import Database
from open_publisher_runtime.infrastructure.providers import MockImageProvider, MockTextProvider
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.workflows.preset import PresetArticleWorkflow


def create_app(settings: Settings | None = None) -> FastAPI:
    runtime_settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        runtime_settings.ensure_directories()
        assert runtime_settings.database_url is not None
        assert runtime_settings.artifact_dir is not None
        database = Database(runtime_settings.database_url)
        database.create_schema()
        blob_store = FileSystemArtifactStore(runtime_settings.artifact_dir)
        model_access = ModelAccessLayer(
            text_provider=MockTextProvider(),
            image_provider=MockImageProvider(),
        )
        container = RuntimeContainer(
            database=database,
            blob_store=blob_store,
            model_access=model_access,
            workflow_runner=PresetArticleWorkflow(model_access),
            dry_run_publisher=DeterministicDryRunPublisher(),
        )
        app.state.container = container
        with database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            WorkflowService(repository).ensure_presets()
        yield
        database.dispose()

    app = FastAPI(
        title="Open Publisher Agent Runtime",
        version=__version__,
        lifespan=lifespan,
    )

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        container: RuntimeContainer = app.state.container
        with container.database.session() as session:
            session.execute(text("SELECT 1"))
        return HealthResponse(status="ok", database="ok", publisher_mode="dry_run")

    app.include_router(router)
    return app


app = create_app()


def run() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        "open_publisher_runtime.main:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":
    run()

