from __future__ import annotations

import base64
import logging
import sys
from datetime import UTC
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from open_publisher_runtime import __version__
from open_publisher_runtime.api.dependencies import (
    RuntimeContainer,
    get_container,
    get_session,
)
from open_publisher_runtime.api.schemas import (
    ApprovePublishPlanRequest,
    ArticleDetail,
    ArticleWithRevision,
    BatchTopicPlanRequest,
    BatchTopicPlanResponse,
    ConnectionProfilePublic,
    CreateArticleRequest,
    CreateConnectionProfileRequest,
    CreateGenerationBatchRequest,
    CreatePublishPlanRequest,
    CreateRevisionRequest,
    CreateRunRequest,
    DemoRequest,
    DemoResponse,
    EnqueueResponse,
    ExportContentPackageRequest,
    GeneratedImageArtifactPublic,
    GenerateImagesRequest,
    GenerateImagesResponse,
    GenerationBatchDetail,
    ImportContentPackageResponse,
    ModelTestRequest,
    ModelTestResponse,
    PlatformCapabilitiesResponse,
    PlatformCapabilitySummary,
    ProcessJobResponse,
    PublishPlanDetail,
    ResumeRunRequest,
    RewriteArticleRequest,
    RewriteArticleResponse,
    RunDetail,
    RuntimeCatalog,
    TemplateExtractionRequest,
    TemplateExtractionResponse,
    VersionResponse,
)
from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.batch_generation import (
    BatchTopicCandidate,
    BatchTopicPlanner,
)
from open_publisher_runtime.application.connections import ConnectionService
from open_publisher_runtime.application.content_packages import ContentPackageService
from open_publisher_runtime.application.harness import (
    WORKFLOW_ARTIFACT_STATE_KEYS,
    RunController,
    WorkflowService,
)
from open_publisher_runtime.application.images import ImageGenerationService
from open_publisher_runtime.application.model_access import TextGenerationRequest
from open_publisher_runtime.application.platform_adapters import (
    WeChatOfficialApiAdapter,
    WeChatOfficialApiProbeInput,
    browser_extension_capability,
    manual_export_capability,
    unsupported_official_api_capability,
)
from open_publisher_runtime.application.publishing import (
    DeliveryRouter,
    PublishOutboxService,
    PublishTarget,
    WechatSyncDraftPublisher,
)
from open_publisher_runtime.application.template_extraction import (
    TemplateExtractionError,
    TemplateExtractionService,
)
from open_publisher_runtime.domain.contracts import ContentPackageV1
from open_publisher_runtime.domain.entities import (
    Article,
    ArticleRevision,
    RuntimeEvent,
    Workflow,
    WorkflowRun,
)
from open_publisher_runtime.domain.enums import RunStatus
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository

SessionDep = Annotated[Session, Depends(get_session)]
ContainerDep = Annotated[RuntimeContainer, Depends(get_container)]

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger(__name__)


def _workflow_event_sort_key(event: RuntimeEvent) -> tuple[object, str]:
    created_at = event.created_at
    if created_at.tzinfo is None:
        # SQLite returns the UTC timestamps it stored as naive values.
        created_at = created_at.replace(tzinfo=UTC)
    return created_at, event.id


def _services(
    session: Session,
    container: RuntimeContainer,
) -> tuple[
    SqlAlchemyRuntimeRepository,
    ArtifactService,
    ArticleService,
    RunController,
    PublishOutboxService,
    ContentPackageService,
]:
    repository = SqlAlchemyRuntimeRepository(session)
    artifacts = ArtifactService(repository, container.blob_store)
    articles = ArticleService(repository, artifacts)

    def record_live_node_event(
        run_id: str,
        node_id: str,
        phase: str,
        payload: dict[str, object] | None = None,
    ) -> None:
        """Split high-frequency editor output from durable workflow checkpoints."""

        event = RuntimeEvent(
            run_id=run_id,
            aggregate_type="workflow_run",
            aggregate_id=run_id,
            event_type=f"run.node_{phase}",
            payload_json={"node_id": node_id, **(payload or {})},
        )
        if phase == "output_delta":
            container.live_workflow_activity.append(event)
            return

        try:
            with container.database.session() as progress_session:
                progress_repository = SqlAlchemyRuntimeRepository(progress_session)
                progress_repository.add_event(event)
        except Exception as error:
            # The UI reads the in-memory entry above. Keep a diagnostic without
            # writing prompts, model output, or credentials to the sidecar log.
            logger.warning(
                "Could not persist live workflow event run=%s phase=%s error=%s",
                run_id,
                phase,
                type(error).__name__,
            )

    controller = RunController(
        repository=repository,
        artifact_service=artifacts,
        article_service=articles,
        workflow_runner=container.workflow_runner,
        node_event_recorder=record_live_node_event,
    )
    publishing = PublishOutboxService(
        repository=repository,
        artifact_service=artifacts,
        publisher=DeliveryRouter(
            dry_run=container.dry_run_publisher,
            wechat_sync=WechatSyncDraftPublisher(artifacts),
        ),
    )
    packages = ContentPackageService(repository, artifacts, articles)
    return repository, artifacts, articles, controller, publishing, packages


def _translate_error(error: Exception) -> HTTPException:
    if isinstance(error, LookupError):
        return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error))
    if isinstance(error, ValueError):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="runtime error")


@router.get("/version", response_model=VersionResponse)
def version() -> VersionResponse:
    try:
        import langgraph  # noqa: F401

        langgraph_available = True
    except ImportError:
        langgraph_available = False
    return VersionResponse(
        name="open-publisher-agent-runtime",
        version=__version__,
        api_version="v1",
        python=f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
        langgraph_available=langgraph_available,
    )


@router.post("/models/test", response_model=ModelTestResponse)
def test_model_connection(
    _request: ModelTestRequest,
    container: ContainerDep,
) -> ModelTestResponse:
    try:
        result = container.model_access.generate_text(
            TextGenerationRequest(
                purpose="connection-test",
                prompt="Reply with OK.",
                temperature=0,
                max_output_tokens=8,
            )
        )
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="model connection test failed",
        ) from error
    return ModelTestResponse(
        provider=result.provider,
        model=result.model,
        mocked=result.mocked,
    )


@router.post("/editor/rewrite", response_model=RewriteArticleResponse)
def rewrite_article(
    request: RewriteArticleRequest,
    container: ContainerDep,
) -> RewriteArticleResponse:
    """Return an editorial candidate without mutating the canonical revision."""

    source = request.selected_text or request.markdown
    scope = "选中的 Markdown 片段" if request.selected_text else "整篇 Markdown 文章"
    prompt = f"""你是严谨的中文编辑助手。请按用户要求修改{scope}。

用户要求：{request.instruction.strip()}

必须遵守：
1. 保留原有 Markdown 语法、链接、图片和代码块，除非用户明确要求修改它们。
2. 不要补造事实、数字、引用、经历或来源；不确定的信息保留原表达或改为审慎措辞。
3. 只返回修改后的 Markdown 正文，不要说明、标题、代码围栏或“修改如下”。
4. 如果是选中片段，只返回该片段的替换内容，不要返回全文。

待修改内容：
---
{source}
---"""
    try:
        result = container.model_access.generate_text(
            TextGenerationRequest(
                purpose="editor-rewrite",
                prompt=prompt,
                context={
                    "source_markdown": source,
                    "instruction": request.instruction.strip(),
                    "scope": "selection" if request.selected_text else "article",
                },
                temperature=0.35,
                max_output_tokens=4_000 if request.selected_text is None else 1_600,
            )
        )
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="article rewrite failed",
        ) from error
    replacement = result.text.strip()
    if replacement.startswith("```") and replacement.endswith("```"):
        replacement = replacement.split("\n", 1)[-1].rsplit("\n", 1)[0].strip()
    if not replacement:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="article rewrite returned no content",
        )
    return RewriteArticleResponse(
        replacement=replacement,
        provider=result.provider,
        model=result.model,
        mocked=result.mocked,
    )


@router.post("/templates/extract", response_model=TemplateExtractionResponse)
def extract_template(
    request: TemplateExtractionRequest,
    container: ContainerDep,
) -> TemplateExtractionResponse:
    try:
        result = TemplateExtractionService(model_access=container.model_access).extract(
            source_markdown=request.source_markdown
        )
    except TemplateExtractionError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"model did not return a reusable template; retry extraction ({error})",
        ) from error
    except Exception as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="template extraction failed",
        ) from error
    return TemplateExtractionResponse(
        name=result.name,
        description=result.description,
        category=result.category,
        markdown=result.markdown,
        style_profile=result.style_profile,
        structure_profile=result.structure_profile,
        layout_profile=result.layout_profile,
        fixed_blocks=result.fixed_blocks,
        variables=result.variables,
        usage_instructions=result.usage_instructions,
        provider=result.provider,
        model=result.model,
        mocked=result.mocked,
    )


@router.get(
    "/platforms/capabilities",
    response_model=PlatformCapabilitiesResponse,
)
def platform_capabilities() -> PlatformCapabilitiesResponse:
    """Describe only the reviewed, offline baseline; never choose a fallback route."""

    return PlatformCapabilitiesResponse(
        platforms=[
            PlatformCapabilitySummary(
                platform="wechat",
                reports=[
                    WeChatOfficialApiAdapter.probe(WeChatOfficialApiProbeInput()),
                    browser_extension_capability(
                        "wechat",
                        installed=False,
                        paired=False,
                    ),
                    manual_export_capability("wechat"),
                ],
            ),
            PlatformCapabilitySummary(
                platform="csdn",
                reports=[
                    unsupported_official_api_capability("csdn"),
                    browser_extension_capability(
                        "csdn",
                        installed=False,
                        paired=False,
                    ),
                    manual_export_capability("csdn"),
                ],
            ),
            PlatformCapabilitySummary(
                platform="toutiao",
                reports=[
                    unsupported_official_api_capability("toutiao"),
                    browser_extension_capability(
                        "toutiao",
                        installed=False,
                        paired=False,
                    ),
                    manual_export_capability("toutiao"),
                ],
            ),
        ],
    )


@router.post(
    "/articles",
    response_model=ArticleWithRevision,
    status_code=status.HTTP_201_CREATED,
)
def create_article(
    request: CreateArticleRequest,
    session: SessionDep,
    container: ContainerDep,
) -> ArticleWithRevision:
    _, _, articles, _, _, _ = _services(session, container)
    try:
        article, revision = articles.create_article(
            title=request.title,
            markdown=request.markdown,
            metadata=request.metadata,
        )
        return ArticleWithRevision(article=article, revision=revision)
    except Exception as error:
        raise _translate_error(error) from error


@router.get("/articles", response_model=list[Article])
def list_articles(session: SessionDep) -> list[Article]:
    return list(SqlAlchemyRuntimeRepository(session).list_articles())


@router.get("/articles/{article_id}", response_model=ArticleDetail)
def get_article(article_id: str, session: SessionDep, container: ContainerDep) -> ArticleDetail:
    repository, _, articles, _, _, _ = _services(session, container)
    try:
        article, latest = articles.get_article_with_latest_revision(article_id)
        return ArticleDetail(
            article=article,
            latest_revision=latest,
            revisions=list(repository.list_revisions(article_id)),
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.post(
    "/articles/{article_id}/revisions",
    response_model=ArticleRevision,
    status_code=status.HTTP_201_CREATED,
)
def create_revision(
    article_id: str,
    request: CreateRevisionRequest,
    session: SessionDep,
    container: ContainerDep,
) -> ArticleRevision:
    _, _, articles, _, _, _ = _services(session, container)
    try:
        return articles.create_revision(
            article_id=article_id,
            markdown=request.markdown,
            parent_revision_id=request.parent_revision_id,
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.get("/articles/{article_id}/revisions", response_model=list[ArticleRevision])
def list_revisions(article_id: str, session: SessionDep) -> list[ArticleRevision]:
    repository = SqlAlchemyRuntimeRepository(session)
    if repository.get_article(article_id) is None:
        raise HTTPException(status_code=404, detail=f"article {article_id} not found")
    return list(repository.list_revisions(article_id))


@router.get("/workflows", response_model=list[Workflow])
def list_workflows(session: SessionDep) -> list[Workflow]:
    return list(SqlAlchemyRuntimeRepository(session).list_workflows())


@router.post("/generation-batches/plan", response_model=BatchTopicPlanResponse)
def plan_generation_batch(
    request: BatchTopicPlanRequest,
    container: ContainerDep,
) -> BatchTopicPlanResponse:
    try:
        if request.manual_topics:
            candidates = [
                BatchTopicCandidate(
                    title=topic[:180],
                    topic=topic,
                    angle="由作者手动指定的独立选题。",
                    key_points=["围绕该选题完成一篇独立文章。"],
                )
                for topic in request.manual_topics
            ]
            return BatchTopicPlanResponse(candidates=candidates, planned_by="manual")
        candidates = BatchTopicPlanner(container.model_access).plan(
            prompt=request.prompt,
            count=request.count,
            references=request.references,
        )
        return BatchTopicPlanResponse(candidates=candidates, planned_by="model")
    except Exception as error:
        raise _translate_error(error) from error


@router.post(
    "/generation-batches",
    response_model=GenerationBatchDetail,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_generation_batch(
    request: CreateGenerationBatchRequest,
    container: ContainerDep,
) -> GenerationBatchDetail:
    try:
        if request.policy.visual_composition.mode != "none":
            raise ValueError("batch image generation is not available in this release")
        batch = container.batch_generation.create_batch(
            prompt=request.prompt,
            candidates=request.candidates,
            source_markdown=request.source_markdown,
            run_policy=request.policy,
            writer_concurrency=request.writer_concurrency,
        )
        persisted, items = container.batch_generation.get_batch(batch.id)
        return GenerationBatchDetail(batch=persisted, items=items)
    except Exception as error:
        raise _translate_error(error) from error


@router.get("/generation-batches", response_model=list[GenerationBatchDetail])
def list_generation_batches(container: ContainerDep) -> list[GenerationBatchDetail]:
    result: list[GenerationBatchDetail] = []
    for batch in container.batch_generation.list_batches():
        persisted, items = container.batch_generation.get_batch(batch.id)
        result.append(GenerationBatchDetail(batch=persisted, items=items))
    return result


@router.get("/generation-batches/{batch_id}", response_model=GenerationBatchDetail)
def get_generation_batch(batch_id: str, container: ContainerDep) -> GenerationBatchDetail:
    try:
        batch, items = container.batch_generation.get_batch(batch_id)
        return GenerationBatchDetail(batch=batch, items=items)
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/generation-batches/{batch_id}/cancel", response_model=GenerationBatchDetail)
def cancel_generation_batch(batch_id: str, container: ContainerDep) -> GenerationBatchDetail:
    try:
        container.batch_generation.cancel_batch(batch_id)
        batch, items = container.batch_generation.get_batch(batch_id)
        return GenerationBatchDetail(batch=batch, items=items)
    except Exception as error:
        raise _translate_error(error) from error


@router.post(
    "/generation-batches/items/{item_id}/retry",
    response_model=GenerationBatchDetail,
)
def retry_generation_item(item_id: str, container: ContainerDep) -> GenerationBatchDetail:
    try:
        item = container.batch_generation.retry_item(item_id)
        batch, items = container.batch_generation.get_batch(item.batch_id)
        return GenerationBatchDetail(batch=batch, items=items)
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/runs", response_model=WorkflowRun, status_code=status.HTTP_201_CREATED)
def start_run(
    request: CreateRunRequest,
    session: SessionDep,
    container: ContainerDep,
) -> WorkflowRun:
    _, _, _, controller, _, _ = _services(session, container)
    try:
        return controller.start(
            workflow_id=request.workflow_id,
            article_id=request.article_id,
            revision_id=request.revision_id,
            topic=request.topic,
            policy=request.policy,
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.get("/runs/active", response_model=RunDetail | None)
def get_active_run(
    article_id: str,
    session: SessionDep,
    container: ContainerDep,
) -> RunDetail | None:
    repository = SqlAlchemyRuntimeRepository(session)
    run = repository.find_active_run(article_id)
    if run is None or run.status not in {RunStatus.QUEUED, RunStatus.RUNNING}:
        return None
    persisted = list(repository.list_events(run.id))
    live = container.live_workflow_activity.snapshot(run.id)
    events_by_id = {event.id: event for event in persisted}
    events_by_id.update({event.id: event for event in live})
    events = sorted(
        (
            event
            for event in events_by_id.values()
            if event.event_type != "run.node_output_checkpoint"
        ),
        key=_workflow_event_sort_key,
    )
    return RunDetail(run=run, events=events)


@router.get("/runs/{run_id}", response_model=RunDetail)
def get_run(run_id: str, session: SessionDep) -> RunDetail:
    repository = SqlAlchemyRuntimeRepository(session)
    run = repository.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return RunDetail(run=run, events=list(repository.list_events(run.id)))


@router.get("/runs/{run_id}/events", response_model=list[RuntimeEvent])
def get_run_events(run_id: str, session: SessionDep) -> list[RuntimeEvent]:
    repository = SqlAlchemyRuntimeRepository(session)
    if repository.get_run(run_id) is None:
        raise HTTPException(status_code=404, detail=f"run {run_id} not found")
    return list(repository.list_events(run_id))


@router.post("/runs/{run_id}/resume", response_model=WorkflowRun)
def resume_run(
    run_id: str,
    request: ResumeRunRequest,
    session: SessionDep,
    container: ContainerDep,
) -> WorkflowRun:
    _, _, _, controller, _, _ = _services(session, container)
    try:
        return controller.resume(run_id=run_id, action=request.action, comment=request.comment)
    except Exception as error:
        raise _translate_error(error) from error


@router.post(
    "/connections",
    response_model=ConnectionProfilePublic,
    status_code=status.HTTP_201_CREATED,
)
def create_connection(
    request: CreateConnectionProfileRequest,
    session: SessionDep,
) -> ConnectionProfilePublic:
    service = ConnectionService(SqlAlchemyRuntimeRepository(session))
    try:
        profile = service.create(
            name=request.name,
            provider=request.provider,
            secret_ref=request.secret_ref,
            base_url=request.base_url,
            config=request.config,
        )
        return ConnectionProfilePublic.from_profile(profile)
    except Exception as error:
        raise _translate_error(error) from error


@router.get("/connections", response_model=list[ConnectionProfilePublic])
def list_connections(session: SessionDep) -> list[ConnectionProfilePublic]:
    return [
        ConnectionProfilePublic.from_profile(profile)
        for profile in SqlAlchemyRuntimeRepository(session).list_connections()
    ]


@router.get("/catalog", response_model=RuntimeCatalog)
def catalog(session: SessionDep) -> RuntimeCatalog:
    repository = SqlAlchemyRuntimeRepository(session)
    return RuntimeCatalog(
        workflows=list(repository.list_workflows()),
        connections=[
            ConnectionProfilePublic.from_profile(profile)
            for profile in repository.list_connections()
        ],
    )


@router.post(
    "/images/generate",
    response_model=GenerateImagesResponse,
    status_code=status.HTTP_201_CREATED,
)
def generate_images(
    request: GenerateImagesRequest,
    session: SessionDep,
    container: ContainerDep,
) -> GenerateImagesResponse:
    repository = SqlAlchemyRuntimeRepository(session)
    artifacts = ArtifactService(repository, container.blob_store)
    service = ImageGenerationService(
        model_access=container.model_access,
        artifact_service=artifacts,
    )
    try:
        result = service.generate(
            prompt=request.prompt,
            size=request.size,
            model=request.model,
        )
        return GenerateImagesResponse(
            provider=result.provider,
            model=result.model,
            mocked=result.mocked,
            artifacts=[
                GeneratedImageArtifactPublic.from_artifact_with_content(
                    artifact,
                    content_base64=base64.b64encode(artifacts.read_bytes(artifact.id)).decode(
                        "ascii"
                    ),
                )
                for artifact in result.artifacts
            ],
            remote_urls_ignored=result.remote_urls_ignored,
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.post(
    "/publish/plans",
    response_model=PublishPlanDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_publish_plan(
    request: CreatePublishPlanRequest,
    session: SessionDep,
    container: ContainerDep,
) -> PublishPlanDetail:
    _, _, _, _, publishing, _ = _services(session, container)
    targets = [PublishTarget.model_validate(target.model_dump()) for target in request.targets]
    try:
        plan, variants = publishing.create_plan(
            revision_id=request.revision_id,
            targets=targets,
            selected_asset_ids=request.selected_asset_ids,
        )
        return PublishPlanDetail(plan=plan, variants=variants)
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/publish/plans/{plan_id}/approve", response_model=PublishPlanDetail)
def approve_publish_plan(
    plan_id: str,
    request: ApprovePublishPlanRequest,
    session: SessionDep,
    container: ContainerDep,
) -> PublishPlanDetail:
    repository, _, _, _, publishing, _ = _services(session, container)
    try:
        plan = publishing.approve(
            plan_id,
            actor_id=request.actor_id,
            comment=request.comment,
        )
        variants = [
            variant
            for variant_id in plan.plan_json.get("variant_ids", [])
            if (variant := repository.get_variant(str(variant_id))) is not None
        ]
        return PublishPlanDetail(
            plan=plan,
            variants=variants,
            jobs=list(repository.list_publish_jobs(plan.id)),
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.get("/publish/plans/{plan_id}", response_model=PublishPlanDetail)
def get_publish_plan(plan_id: str, session: SessionDep) -> PublishPlanDetail:
    repository = SqlAlchemyRuntimeRepository(session)
    plan = repository.get_publish_plan(plan_id)
    if plan is None:
        raise HTTPException(status_code=404, detail=f"publish plan {plan_id} not found")
    variants = [
        variant
        for variant_id in plan.plan_json.get("variant_ids", [])
        if (variant := repository.get_variant(str(variant_id))) is not None
    ]
    return PublishPlanDetail(
        plan=plan,
        variants=variants,
        jobs=list(repository.list_publish_jobs(plan.id)),
    )


@router.post("/publish/plans/{plan_id}/enqueue", response_model=EnqueueResponse)
def enqueue_publish_plan(
    plan_id: str,
    session: SessionDep,
    container: ContainerDep,
) -> EnqueueResponse:
    repository, _, _, _, publishing, _ = _services(session, container)
    try:
        jobs = publishing.enqueue(plan_id)
        plan = repository.get_publish_plan(plan_id)
        assert plan is not None
        return EnqueueResponse(plan=plan, jobs=jobs)
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/publish/jobs/{job_id}/process", response_model=ProcessJobResponse)
def process_publish_job(
    job_id: str,
    session: SessionDep,
    container: ContainerDep,
) -> ProcessJobResponse:
    _, _, _, _, publishing, _ = _services(session, container)
    try:
        job, receipt = publishing.process(job_id)
        return ProcessJobResponse(job=job, receipt=receipt)
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/publish/jobs/{job_id}/reconcile", response_model=ProcessJobResponse)
def reconcile_publish_job(
    job_id: str,
    session: SessionDep,
    container: ContainerDep,
) -> ProcessJobResponse:
    _, _, _, _, publishing, _ = _services(session, container)
    try:
        job, receipt = publishing.reconcile(job_id)
        return ProcessJobResponse(job=job, receipt=receipt)
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/content-packages/export", response_model=ContentPackageV1)
def export_content_package(
    request: ExportContentPackageRequest,
    session: SessionDep,
    container: ContainerDep,
) -> ContentPackageV1:
    _, _, _, _, _, packages = _services(session, container)
    try:
        return packages.export(
            article_id=request.article_id,
            revision_id=request.revision_id,
            artifact_ids=request.artifact_ids,
            platform_variant_ids=request.platform_variant_ids,
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.post(
    "/content-packages/import",
    response_model=ImportContentPackageResponse,
    status_code=status.HTTP_201_CREATED,
)
def import_content_package(
    request: ContentPackageV1,
    session: SessionDep,
    container: ContainerDep,
) -> ImportContentPackageResponse:
    _, _, _, _, _, packages = _services(session, container)
    try:
        article, revision, artifacts = packages.import_package(request)
        return ImportContentPackageResponse(
            article=article,
            revision=revision,
            imported_artifacts=artifacts,
        )
    except Exception as error:
        raise _translate_error(error) from error


@router.post("/demo/complete", response_model=DemoResponse)
def complete_demo(
    request: DemoRequest,
    session: SessionDep,
    container: ContainerDep,
) -> DemoResponse:
    repository, _, articles, controller, publishing, packages = _services(session, container)
    try:
        article, input_revision = articles.create_article(
            title=request.title,
            markdown=request.source_markdown,
            metadata={"demo": True},
        )
        workflow = WorkflowService(repository).ensure_presets()
        run = controller.start(
            workflow_id=workflow.id,
            article_id=article.id,
            revision_id=input_revision.id,
            topic=request.topic,
            policy=request_policy_no_approval(request.disabled_optional_node_ids),
        )
        if run.output_revision_id is None:
            raise RuntimeError("demo workflow did not produce a revision")
        output_revision = repository.get_revision(run.output_revision_id)
        assert output_revision is not None
        plan, variants = publishing.create_plan(
            revision_id=output_revision.id,
            targets=[
                PublishTarget(
                    platform=platform,
                    account_ref=f"demo-{platform}",
                    simulate_outcome="success",
                )
                for platform in request.platforms
            ],
        )
        publishing.approve(
            plan.id,
            actor_id="demo:local-user",
            comment="explicit internal approval for deterministic dry-run demo",
            source="dry_run_demo",
        )
        jobs = publishing.enqueue(plan.id)
        receipts = []
        for job in jobs:
            processed_job, receipt = publishing.process(job.id)
            job.state = processed_job.state
            if receipt:
                receipts.append(receipt)
        refreshed_plan = repository.get_publish_plan(plan.id)
        assert refreshed_plan is not None
        workflow_artifact_ids = [
            str(run.state_json[key])
            for key in WORKFLOW_ARTIFACT_STATE_KEYS
            if run.state_json.get(key)
        ]
        variant_artifact_ids = [variant.body_artifact_id for variant in variants]
        package = packages.export(
            article_id=article.id,
            revision_id=output_revision.id,
            artifact_ids=[*workflow_artifact_ids, *variant_artifact_ids],
            platform_variant_ids=[variant.id for variant in variants],
        )
        return DemoResponse(
            article=article,
            input_revision=input_revision,
            run=run,
            output_revision=output_revision,
            plan=refreshed_plan,
            variants=variants,
            jobs=jobs,
            receipts=receipts,
            content_package=package,
        )
    except Exception as error:
        raise _translate_error(error) from error


def request_policy_no_approval(disabled_optional_node_ids: list[str] | None = None):
    from open_publisher_runtime.domain.policies import RunPolicy

    return RunPolicy.model_validate(
        {
            "require_content_approval": False,
            "disabled_optional_node_ids": disabled_optional_node_ids or [],
        }
    )


def no_content() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)
