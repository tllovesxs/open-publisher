from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from threading import Lock, Semaphore

from pydantic import BaseModel, ConfigDict, Field

from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.harness import RunController, WorkflowService
from open_publisher_runtime.application.model_access import ModelAccessLayer, TextGenerationRequest
from open_publisher_runtime.domain.entities import GenerationBatch, GenerationItem, utc_now
from open_publisher_runtime.domain.enums import GenerationBatchStatus, GenerationItemStatus
from open_publisher_runtime.domain.policies import RunPolicy
from open_publisher_runtime.infrastructure.artifact_store import FileSystemArtifactStore
from open_publisher_runtime.infrastructure.database import Database
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.workflows.preset import PresetArticleWorkflow


class BatchTopicCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=180)
    topic: str = Field(min_length=1, max_length=1000)
    angle: str = Field(min_length=1, max_length=500)
    key_points: list[str] = Field(min_length=1, max_length=8)


class BatchTopicPlanner:
    """Uses one bounded model call to turn a broad brief into distinct articles."""

    def __init__(self, model_access: ModelAccessLayer) -> None:
        self.model_access = model_access

    def plan(self, *, prompt: str, count: int, references: str = "") -> list[BatchTopicCandidate]:
        response = self.model_access.generate_text(
            TextGenerationRequest(
                purpose="batch-topic-plan",
                prompt=(
                    "把下面的创作需求拆成互不重复的文章选题。只输出 JSON 数组，不要代码围栏或解释。"
                    "每项必须包含 title、topic、angle、key_points；key_points 是 2 到 6 条短句。"
                    f"恰好输出 {count} 项，避免同义改写和虚构事实。\n\n"
                    f"创作需求：\n{prompt}\n\n参考资料：\n{references or '无'}"
                ),
                context={"prompt": prompt, "references": references, "count": count},
                temperature=0.4,
                max_output_tokens=min(3_000, 500 * count),
            )
        )
        candidates = self._parse_candidates(response.text)
        if len(candidates) != count:
            raise ValueError(f"选题规划返回了 {len(candidates)} 项，需要 {count} 项")
        return candidates

    @staticmethod
    def _parse_candidates(value: str) -> list[BatchTopicCandidate]:
        normalized = value.strip()
        if normalized.startswith("```"):
            normalized = re.sub(r"^```(?:json)?\s*|\s*```$", "", normalized).strip()
        try:
            payload = json.loads(normalized)
        except json.JSONDecodeError as error:
            raise ValueError("选题规划未返回有效 JSON") from error
        if not isinstance(payload, list):
            raise ValueError("选题规划必须返回 JSON 数组")
        return [BatchTopicCandidate.model_validate(item) for item in payload]


class BatchGenerationService:
    """Persistent batch scheduler with bounded, per-item workflow execution."""

    def __init__(
        self,
        *,
        database: Database,
        blob_store: FileSystemArtifactStore,
        workflow_runner: PresetArticleWorkflow,
        max_global_writers: int = 2,
    ) -> None:
        self.database = database
        self.blob_store = blob_store
        self.workflow_runner = workflow_runner
        self._writer_slots = Semaphore(max_global_writers)
        self._executor = ThreadPoolExecutor(
            max_workers=max_global_writers * 2,
            thread_name_prefix="open-publisher-batch",
        )
        self._lock = Lock()
        self._batch_slots: dict[str, Semaphore] = {}
        self._submitted_items: set[str] = set()

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def recover_interrupted_items(self) -> int:
        recovered = 0
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            for item in repository.list_generation_items_by_statuses(
                [GenerationItemStatus.RUNNING]
            ):
                item.status = GenerationItemStatus.INTERRUPTED
                item.error = "RuntimeRestart: batch worker stopped; retry this item"
                item.completed_at = utc_now()
                repository.update_generation_item(item)
                recovered += 1
            for batch in repository.list_generation_batches(limit=100):
                if batch.status is GenerationBatchStatus.RUNNING:
                    batch.status = GenerationBatchStatus.NEEDS_ATTENTION
                    batch.updated_at = utc_now()
                    repository.update_generation_batch(batch)
        return recovered

    def create_batch(
        self,
        *,
        prompt: str,
        candidates: list[BatchTopicCandidate],
        source_markdown: str,
        run_policy: RunPolicy,
        writer_concurrency: int,
    ) -> GenerationBatch:
        if not candidates:
            raise ValueError("batch needs at least one selected topic")
        if len(candidates) > 10:
            raise ValueError("batch supports at most ten articles")
        if not 1 <= writer_concurrency <= 4:
            raise ValueError("writer concurrency must be between 1 and 4")
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            batch = repository.add_generation_batch(
                GenerationBatch(
                    prompt=prompt,
                    policy_json={"run_policy": run_policy.model_dump(mode="json")},
                    writer_concurrency=writer_concurrency,
                )
            )
            for position, candidate in enumerate(candidates, start=1):
                repository.add_generation_item(
                    GenerationItem(
                        batch_id=batch.id,
                        position=position,
                        title=candidate.title,
                        topic=candidate.topic,
                        input_json={
                            "source_markdown": source_markdown,
                            "angle": candidate.angle,
                            "key_points": candidate.key_points,
                        },
                    )
                )
        self.enqueue_batch(batch.id)
        return batch

    def enqueue_batch(self, batch_id: str) -> None:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            batch = repository.get_generation_batch(batch_id)
            if batch is None:
                raise LookupError(f"generation batch {batch_id} not found")
            if batch.status is GenerationBatchStatus.CANCELLED:
                return
            if batch.status is not GenerationBatchStatus.RUNNING:
                batch.status = GenerationBatchStatus.RUNNING
                batch.updated_at = utc_now()
                repository.update_generation_batch(batch)
            item_ids = [
                item.id
                for item in repository.list_generation_items(batch_id)
                if item.status is GenerationItemStatus.QUEUED
            ]
        with self._lock:
            self._batch_slots.setdefault(batch_id, Semaphore(batch.writer_concurrency))
            for item_id in item_ids:
                if item_id in self._submitted_items:
                    continue
                self._submitted_items.add(item_id)
                self._executor.submit(self._run_item, item_id)

    def retry_item(self, item_id: str) -> GenerationItem:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            item = repository.get_generation_item(item_id)
            if item is None:
                raise LookupError(f"generation item {item_id} not found")
            if item.status not in {
                GenerationItemStatus.FAILED,
                GenerationItemStatus.INTERRUPTED,
                GenerationItemStatus.CANCELLED,
            }:
                raise ValueError("only failed, interrupted, or cancelled items can be retried")
            item.status = GenerationItemStatus.QUEUED
            item.error = None
            item.completed_at = None
            item.retry_count += 1
            repository.update_generation_item(item)
            batch = repository.get_generation_batch(item.batch_id)
            assert batch is not None
            batch.status = GenerationBatchStatus.QUEUED
            batch.updated_at = utc_now()
            repository.update_generation_batch(batch)
        self.enqueue_batch(item.batch_id)
        return item

    def cancel_batch(self, batch_id: str) -> GenerationBatch:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            batch = repository.get_generation_batch(batch_id)
            if batch is None:
                raise LookupError(f"generation batch {batch_id} not found")
            batch.status = GenerationBatchStatus.CANCELLED
            batch.updated_at = utc_now()
            repository.update_generation_batch(batch)
            for item in repository.list_generation_items(batch_id):
                if item.status is GenerationItemStatus.QUEUED:
                    item.status = GenerationItemStatus.CANCELLED
                    item.completed_at = utc_now()
                    repository.update_generation_item(item)
            return batch

    def get_batch(self, batch_id: str) -> tuple[GenerationBatch, list[GenerationItem]]:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            batch = repository.get_generation_batch(batch_id)
            if batch is None:
                raise LookupError(f"generation batch {batch_id} not found")
            return batch, list(repository.list_generation_items(batch_id))

    def list_batches(self, *, limit: int = 30) -> list[GenerationBatch]:
        with self.database.session() as session:
            return list(SqlAlchemyRuntimeRepository(session).list_generation_batches(limit=limit))

    def _run_item(self, item_id: str) -> None:
        batch_id = ""
        try:
            with self._lock:
                # A retry can be submitted after a previous worker has exited.
                self._submitted_items.discard(item_id)
            with self.database.session() as session:
                repository = SqlAlchemyRuntimeRepository(session)
                item = repository.get_generation_item(item_id)
                if item is None or item.status is not GenerationItemStatus.QUEUED:
                    return
                batch = repository.get_generation_batch(item.batch_id)
                if batch is None or batch.status is GenerationBatchStatus.CANCELLED:
                    return
                batch_id = batch.id
            with self._lock:
                batch_slot = self._batch_slots.setdefault(
                    batch_id,
                    Semaphore(batch.writer_concurrency),
                )
            with batch_slot, self._writer_slots:
                self._execute_claimed_item(item_id)
        except Exception as error:  # noqa: BLE001 - worker boundary persists a retryable failure
            self._mark_item_failed(item_id, error)
        finally:
            if batch_id:
                self._refresh_batch_status(batch_id)

    def _mark_item_failed(self, item_id: str, error: Exception) -> None:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            item = repository.get_generation_item(item_id)
            if item is None or item.status is not GenerationItemStatus.RUNNING:
                return
            item.status = GenerationItemStatus.FAILED
            item.error = f"{type(error).__name__}: {error}"[:2_000]
            item.completed_at = utc_now()
            repository.update_generation_item(item)

    def _execute_claimed_item(self, item_id: str) -> None:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            item = repository.get_generation_item(item_id)
            if item is None or item.status is not GenerationItemStatus.QUEUED:
                return
            batch = repository.get_generation_batch(item.batch_id)
            if batch is None or batch.status is GenerationBatchStatus.CANCELLED:
                return
            item.status = GenerationItemStatus.RUNNING
            item.started_at = utc_now()
            repository.update_generation_item(item)

            artifacts = ArtifactService(repository, self.blob_store)
            articles = ArticleService(repository, artifacts)
            article, revision = articles.create_article(
                title=item.title,
                markdown=self._source_markdown(item),
                metadata={
                    "generation_batch_id": batch.id,
                    "generation_item_id": item.id,
                },
            )
            workflow = repository.find_workflow(
                WorkflowService.PRESET_NAME,
                WorkflowService.PRESET_VERSION,
            )
            if workflow is None:
                raise RuntimeError("default writing workflow is unavailable")
            run_policy = RunPolicy.model_validate(batch.policy_json.get("run_policy", {}))
            controller = RunController(
                repository=repository,
                artifact_service=artifacts,
                article_service=articles,
                workflow_runner=self.workflow_runner,
            )
            run = controller.start(
                workflow_id=workflow.id,
                article_id=article.id,
                revision_id=revision.id,
                topic=item.topic,
                policy=run_policy,
            )
            item.article_id = article.id
            item.run_id = run.id
            item.completed_at = utc_now()
            if run.status.value == "completed":
                item.status = GenerationItemStatus.COMPLETED
                item.error = None
            else:
                item.status = GenerationItemStatus.FAILED
                item.error = (run.error or "workflow did not complete")[:2_000]
            repository.update_generation_item(item)

    @staticmethod
    def _source_markdown(item: GenerationItem) -> str:
        values = item.input_json
        source = str(values.get("source_markdown") or "").strip()
        angle = str(values.get("angle") or "").strip()
        points = values.get("key_points")
        point_lines = "\n".join(
            f"- {point}" for point in points if isinstance(point, str) and point.strip()
        ) if isinstance(points, list) else ""
        return "\n\n".join(
            part
            for part in (
                source,
                f"本篇切入角度：{angle}" if angle else "",
                f"本篇必须覆盖：\n{point_lines}" if point_lines else "",
            )
            if part
        ) or item.topic

    def _refresh_batch_status(self, batch_id: str) -> None:
        with self.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            batch = repository.get_generation_batch(batch_id)
            if batch is None or batch.status is GenerationBatchStatus.CANCELLED:
                return
            items = repository.list_generation_items(batch_id)
            states = {item.status for item in items}
            if states.intersection({GenerationItemStatus.QUEUED, GenerationItemStatus.RUNNING}):
                target = GenerationBatchStatus.RUNNING
            elif states == {GenerationItemStatus.COMPLETED}:
                target = GenerationBatchStatus.COMPLETED
            else:
                target = GenerationBatchStatus.NEEDS_ATTENTION
            if batch.status is not target:
                batch.status = target
                batch.updated_at = utc_now()
                repository.update_generation_batch(batch)
