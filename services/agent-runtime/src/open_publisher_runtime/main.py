from __future__ import annotations

import os
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import uvicorn
from fastapi import Depends, FastAPI
from sqlalchemy import text

from open_publisher_runtime import __version__
from open_publisher_runtime.api.dependencies import RuntimeContainer, require_sidecar_token
from open_publisher_runtime.api.live_activity import LiveWorkflowActivityStore
from open_publisher_runtime.api.routes import router
from open_publisher_runtime.api.schemas import HealthResponse
from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.batch_generation import BatchGenerationService
from open_publisher_runtime.application.harness import RunController, WorkflowService
from open_publisher_runtime.application.model_access import ModelAccessLayer
from open_publisher_runtime.application.publishing import (
    DeterministicDryRunPublisher,
    PublishOutboxService,
)
from open_publisher_runtime.application.web_search import TavilySearchTool
from open_publisher_runtime.config import Settings
from open_publisher_runtime.infrastructure.artifact_store import FileSystemArtifactStore
from open_publisher_runtime.infrastructure.database import Database
from open_publisher_runtime.infrastructure.providers import (
    MockImageProvider,
    MockTextProvider,
    OpenAICompatibleImageProvider,
    OpenAICompatibleTextProvider,
    UnconfiguredImageProvider,
    UnconfiguredTextProvider,
)
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.workflows.preset import PresetArticleWorkflow

MODEL_API_KEY_ENV = "OPEN_PUBLISHER_MODEL_API_KEY"
LEGACY_SILICONFLOW_API_KEY_ENV = "OPEN_PUBLISHER_SILICONFLOW_API_KEY"
TEXT_BASE_URL_ENV = "OPEN_PUBLISHER_TEXT_BASE_URL"
TEXT_MODEL_ENV = "OPEN_PUBLISHER_TEXT_MODEL"
IMAGE_BASE_URL_ENV = "OPEN_PUBLISHER_IMAGE_BASE_URL"
IMAGE_MODEL_ENV = "OPEN_PUBLISHER_IMAGE_MODEL"
IMAGE_TRUSTED_HOSTS_ENV = "OPEN_PUBLISHER_IMAGE_TRUSTED_HOSTS"
MODEL_TIMEOUT_SECONDS_ENV = "OPEN_PUBLISHER_MODEL_TIMEOUT_SECONDS"
TAVILY_API_KEY_ENV = "OPEN_PUBLISHER_TAVILY_API_KEY"
LOCAL_DEMO_ENV = "OPEN_PUBLISHER_LOCAL_DEMO"
MODEL_ENV_VARIABLES = (
    MODEL_API_KEY_ENV,
    LEGACY_SILICONFLOW_API_KEY_ENV,
    TEXT_BASE_URL_ENV,
    TEXT_MODEL_ENV,
    IMAGE_BASE_URL_ENV,
    IMAGE_MODEL_ENV,
    IMAGE_TRUSTED_HOSTS_ENV,
    MODEL_TIMEOUT_SECONDS_ENV,
    TAVILY_API_KEY_ENV,
    LOCAL_DEMO_ENV,
)

SILICONFLOW_BASE_URL = "https://api.siliconflow.cn/v1"
SILICONFLOW_TEXT_MODEL = "deepseek-ai/DeepSeek-V3.2"
SILICONFLOW_IMAGE_MODEL = "Qwen/Qwen-Image"
SILICONFLOW_IMAGE_HOSTS = frozenset({"s3.siliconflow.cn"})
DEFAULT_MODEL_TIMEOUT_SECONDS = 120.0


def _environment_value(environment: Mapping[str, str], name: str) -> str | None:
    value = environment.get(name, "").strip()
    return value or None


def _model_timeout_seconds(environment: Mapping[str, str]) -> float:
    raw_value = _environment_value(environment, MODEL_TIMEOUT_SECONDS_ENV)
    if raw_value is None:
        return DEFAULT_MODEL_TIMEOUT_SECONDS
    try:
        timeout_seconds = float(raw_value)
    except ValueError as error:
        raise ValueError(f"{MODEL_TIMEOUT_SECONDS_ENV} must be a number") from error
    if not 1 <= timeout_seconds <= 1800:
        raise ValueError(f"{MODEL_TIMEOUT_SECONDS_ENV} must be between 1 and 1800")
    return timeout_seconds


def _is_siliconflow_url(base_url: str) -> bool:
    return urlparse(base_url).hostname == "api.siliconflow.cn"


def _local_demo_enabled(environment: Mapping[str, str]) -> bool:
    value = _environment_value(environment, LOCAL_DEMO_ENV)
    if value is None:
        return False
    if value.casefold() in {"1", "true", "yes"}:
        return True
    if value.casefold() in {"0", "false", "no"}:
        return False
    raise ValueError(f"{LOCAL_DEMO_ENV} must be true or false")


def web_search_tool_from_env(
    environment: Mapping[str, str] | None = None,
) -> TavilySearchTool | None:
    values = os.environ if environment is None else environment
    api_key = _environment_value(values, TAVILY_API_KEY_ENV)
    return TavilySearchTool(api_key=api_key) if api_key is not None else None


def model_access_from_env(
    environment: Mapping[str, str] | None = None,
) -> ModelAccessLayer:
    values = os.environ if environment is None else environment
    generic_api_key = _environment_value(values, MODEL_API_KEY_ENV)
    legacy_api_key = _environment_value(values, LEGACY_SILICONFLOW_API_KEY_ENV)
    api_key = generic_api_key or legacy_api_key
    local_demo = _local_demo_enabled(values)
    if api_key is None and local_demo:
        return ModelAccessLayer(
            text_provider=MockTextProvider(),
            image_provider=MockImageProvider(),
        )

    use_legacy_defaults = generic_api_key is None and legacy_api_key is not None
    timeout_seconds = _model_timeout_seconds(values)
    text_base_url = _environment_value(values, TEXT_BASE_URL_ENV)
    text_model = _environment_value(values, TEXT_MODEL_ENV)
    image_base_url = _environment_value(values, IMAGE_BASE_URL_ENV)
    image_model = _environment_value(values, IMAGE_MODEL_ENV)
    if use_legacy_defaults:
        text_base_url = text_base_url or SILICONFLOW_BASE_URL
        text_model = text_model or SILICONFLOW_TEXT_MODEL
        image_base_url = image_base_url or SILICONFLOW_BASE_URL
        image_model = image_model or SILICONFLOW_IMAGE_MODEL

    text_provider = UnconfiguredTextProvider()
    if api_key and text_base_url and text_model:
        text_provider = OpenAICompatibleTextProvider(
            base_url=text_base_url,
            api_key=api_key,
            default_model=text_model,
            timeout_seconds=timeout_seconds,
            max_output_tokens=1400,
        )

    trusted_hosts_value = _environment_value(values, IMAGE_TRUSTED_HOSTS_ENV)
    trusted_hosts = frozenset(
        host.strip()
        for host in (trusted_hosts_value or "").split(",")
        if host.strip()
    )
    image_provider = UnconfiguredImageProvider()
    if api_key and image_base_url and image_model:
        siliconflow_image = _is_siliconflow_url(image_base_url)
        if siliconflow_image and not trusted_hosts:
            trusted_hosts = SILICONFLOW_IMAGE_HOSTS
        image_provider = OpenAICompatibleImageProvider(
            base_url=image_base_url,
            api_key=api_key,
            default_model=image_model,
            timeout_seconds=timeout_seconds,
            trusted_image_hosts=trusted_hosts,
            size_field="image_size" if siliconflow_image else "size",
            response_format=None if siliconflow_image else "b64_json",
            extra_request_fields=(
                {
                    "batch_size": 1,
                    "num_inference_steps": 20,
                    "guidance_scale": 4.0,
                }
                if siliconflow_image
                else None
            ),
        )
    return ModelAccessLayer(
        text_provider=text_provider,
        image_provider=image_provider,
    )


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
        model_access = model_access_from_env()
        web_search_tool = web_search_tool_from_env()
        workflow_runner = PresetArticleWorkflow(
            model_access,
            web_search_tool=web_search_tool,
        )
        container = RuntimeContainer(
            database=database,
            blob_store=blob_store,
            model_access=model_access,
            workflow_runner=workflow_runner,
            dry_run_publisher=DeterministicDryRunPublisher(),
            live_workflow_activity=LiveWorkflowActivityStore(),
            batch_generation=BatchGenerationService(
                database=database,
                blob_store=blob_store,
                workflow_runner=workflow_runner,
            ),
        )
        app.state.container = container
        with database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            WorkflowService(repository).ensure_presets()
            artifacts = ArtifactService(repository, blob_store)
            articles = ArticleService(repository, artifacts)
            RunController(
                repository=repository,
                artifact_service=artifacts,
                article_service=articles,
                workflow_runner=container.workflow_runner,
            ).recover_interrupted_runs()
            container.batch_generation.recover_interrupted_items()
            PublishOutboxService(
                repository=repository,
                artifact_service=artifacts,
                publisher=container.dry_run_publisher,
            ).recover_interrupted_jobs()
        yield
        container.batch_generation.shutdown()
        database.dispose()

    app = FastAPI(
        title="Open Publisher Agent Runtime",
        version=__version__,
        lifespan=lifespan,
        dependencies=[Depends(require_sidecar_token)],
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    assert runtime_settings.api_token is not None
    app.state.api_token = runtime_settings.api_token

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        container: RuntimeContainer = app.state.container
        with container.database.session() as session:
            session.execute(text("SELECT 1"))
        return HealthResponse(
            status="ok",
            database="ok",
            publisher_mode="dry_run_and_wechat_sync_draft",
        )

    app.include_router(router)
    return app


app = create_app()


def run() -> None:
    settings = Settings.from_env()
    uvicorn.run(
        create_app(settings),
        host=settings.api_host,
        port=settings.api_port,
        reload=False,
    )


if __name__ == "__main__":
    run()
