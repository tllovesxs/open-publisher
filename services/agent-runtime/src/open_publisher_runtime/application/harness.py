from __future__ import annotations

import hashlib
import json

from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.entities import (
    RuntimeEvent,
    Workflow,
    WorkflowRun,
    utc_now,
)
from open_publisher_runtime.domain.enums import ApprovalStatus, RunStatus
from open_publisher_runtime.domain.policies import RunPolicy
from open_publisher_runtime.workflows.preset import (
    PresetArticleWorkflow,
    PresetWorkflowInput,
    preset_definition,
)


class EventRecorder:
    def __init__(self, repository: RuntimeRepository) -> None:
        self.repository = repository

    def record(
        self,
        *,
        run_id: str | None,
        aggregate_type: str,
        aggregate_id: str,
        event_type: str,
        payload: dict[str, object] | None = None,
    ) -> RuntimeEvent:
        return self.repository.add_event(
            RuntimeEvent(
                run_id=run_id,
                aggregate_type=aggregate_type,
                aggregate_id=aggregate_id,
                event_type=event_type,
                payload_json=payload or {},
            )
        )


class WorkflowService:
    PRESET_NAME = "mock-article"
    PRESET_VERSION = "1.0.0"

    def __init__(self, repository: RuntimeRepository) -> None:
        self.repository = repository

    def ensure_presets(self) -> Workflow:
        existing = self.repository.find_workflow(self.PRESET_NAME, self.PRESET_VERSION)
        if existing:
            return existing
        definition = preset_definition()
        serialized = json.dumps(
            definition,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        workflow = Workflow(
            name=self.PRESET_NAME,
            version=self.PRESET_VERSION,
            definition_json=definition,
            definition_hash=hashlib.sha256(serialized).hexdigest(),
        )
        return self.repository.add_workflow(workflow)


class RunController:
    """Thin Harness: lifecycle, policy, artifact lineage, approval, and events."""

    def __init__(
        self,
        *,
        repository: RuntimeRepository,
        artifact_service: ArtifactService,
        article_service: ArticleService,
        workflow_runner: PresetArticleWorkflow,
    ) -> None:
        self.repository = repository
        self.artifact_service = artifact_service
        self.article_service = article_service
        self.workflow_runner = workflow_runner
        self.events = EventRecorder(repository)

    def start(
        self,
        *,
        workflow_id: str,
        article_id: str,
        revision_id: str,
        topic: str | None,
        policy: RunPolicy,
    ) -> WorkflowRun:
        workflow = self.repository.get_workflow(workflow_id)
        article = self.repository.get_article(article_id)
        revision = self.repository.get_revision(revision_id)
        if workflow is None:
            raise LookupError(f"workflow {workflow_id} not found")
        if article is None:
            raise LookupError(f"article {article_id} not found")
        if revision is None or revision.article_id != article_id:
            raise LookupError("input revision does not belong to the requested article")

        run = WorkflowRun(
            workflow_id=workflow.id,
            article_id=article.id,
            input_revision_id=revision.id,
            status=RunStatus.QUEUED,
            approval_status=(
                ApprovalStatus.PENDING
                if policy.require_content_approval
                else ApprovalStatus.NOT_REQUIRED
            ),
            workflow_snapshot_json={
                "workflow_id": workflow.id,
                "name": workflow.name,
                "version": workflow.version,
                "definition_hash": workflow.definition_hash,
                "definition": workflow.definition_json,
                "policy": policy.model_dump(mode="json"),
            },
            state_json={},
        )
        self.repository.add_run(run)
        self.events.record(
            run_id=run.id,
            aggregate_type="workflow_run",
            aggregate_id=run.id,
            event_type="run.queued",
            payload={"workflow_version": workflow.version},
        )

        run.status = RunStatus.RUNNING
        run.started_at = utc_now()
        self.repository.update_run(run)
        self.events.record(
            run_id=run.id,
            aggregate_type="workflow_run",
            aggregate_id=run.id,
            event_type="run.started",
        )
        # The running claim and audit events must be visible before model I/O starts.
        self.repository.commit()

        try:
            if policy.max_model_calls < self.workflow_runner.required_model_calls:
                raise ValueError(
                    "run policy model-call budget is smaller than the preset requirement "
                    f"({policy.max_model_calls} < {self.workflow_runner.required_model_calls})"
                )
            output = self.workflow_runner.run(
                PresetWorkflowInput(
                    title=article.title,
                    topic=(topic or article.title).strip(),
                    source_markdown=revision.markdown,
                )
            )
            outline_artifact = self.artifact_service.put_text(
                kind="workflow.outline",
                text=output.outline,
                media_type="text/markdown; charset=utf-8",
                metadata={"run_id": run.id, "workflow_id": workflow.id},
            )
            review_artifact = self.artifact_service.put_text(
                kind="workflow.review-report",
                text=output.review_report,
                media_type="text/markdown; charset=utf-8",
                metadata={"run_id": run.id, "workflow_id": workflow.id},
            )
            draft_artifact = self.artifact_service.put_text(
                kind="workflow.canonical-draft",
                text=output.canonical_markdown,
                media_type="text/markdown; charset=utf-8",
                metadata={
                    "run_id": run.id,
                    "workflow_id": workflow.id,
                    "input_revision_id": revision.id,
                },
            )
            run.state_json = {
                "engine": output.engine,
                "outline_artifact_id": outline_artifact.id,
                "review_artifact_id": review_artifact.id,
                "pending_draft_artifact_id": draft_artifact.id,
                "input_revision_hash": revision.content_hash,
            }

            if policy.require_content_approval:
                run.status = RunStatus.WAITING_APPROVAL
                run.interrupt_json = {
                    "type": "content_approval",
                    "draft_artifact_id": draft_artifact.id,
                    "review_artifact_id": review_artifact.id,
                    "actions": ["approve", "reject"],
                }
                self.repository.update_run(run)
                self.events.record(
                    run_id=run.id,
                    aggregate_type="workflow_run",
                    aggregate_id=run.id,
                    event_type="run.interrupted",
                    payload={"reason": "content_approval"},
                )
                self.repository.commit()
                return run

            return self._finalize(run)
        except Exception as error:  # noqa: BLE001 - boundary converts failure into durable state
            self.repository.rollback()
            persisted_run = self.repository.get_run(run.id)
            if persisted_run is not None:
                run = persisted_run
            run.status = RunStatus.FAILED
            run.error = f"{type(error).__name__}: {error}"
            run.completed_at = utc_now()
            self.repository.update_run(run)
            self.events.record(
                run_id=run.id,
                aggregate_type="workflow_run",
                aggregate_id=run.id,
                event_type="run.failed",
                payload={"error_type": type(error).__name__},
            )
            self.repository.commit()
            return run

    def resume(self, *, run_id: str, action: str, comment: str | None = None) -> WorkflowRun:
        run = self.repository.get_run(run_id)
        if run is None:
            raise LookupError(f"run {run_id} not found")
        if run.status is not RunStatus.WAITING_APPROVAL:
            raise ValueError("run is not waiting for approval")
        normalized_action = action.strip().lower()
        if normalized_action == "reject":
            run.status = RunStatus.REJECTED
            run.approval_status = ApprovalStatus.REJECTED
            run.interrupt_json = None
            run.completed_at = utc_now()
            self.repository.update_run(run)
            self.events.record(
                run_id=run.id,
                aggregate_type="workflow_run",
                aggregate_id=run.id,
                event_type="run.rejected",
                payload={"comment": comment or ""},
            )
            self.repository.commit()
            return run
        if normalized_action != "approve":
            raise ValueError("action must be approve or reject")
        run.approval_status = ApprovalStatus.APPROVED
        run.interrupt_json = None
        self.events.record(
            run_id=run.id,
            aggregate_type="workflow_run",
            aggregate_id=run.id,
            event_type="run.approved",
            payload={"comment": comment or ""},
        )
        return self._finalize(run)

    def _finalize(self, run: WorkflowRun) -> WorkflowRun:
        draft_artifact_id = str(run.state_json["pending_draft_artifact_id"])
        markdown = self.artifact_service.read_text(draft_artifact_id)
        revision = self.article_service.create_revision(
            article_id=run.article_id,
            markdown=markdown,
            parent_revision_id=run.input_revision_id,
        )
        run.output_revision_id = revision.id
        run.status = RunStatus.COMPLETED
        run.completed_at = utc_now()
        run.state_json = {
            **run.state_json,
            "output_revision_id": revision.id,
            "output_revision_hash": revision.content_hash,
        }
        self.repository.update_run(run)
        self.events.record(
            run_id=run.id,
            aggregate_type="workflow_run",
            aggregate_id=run.id,
            event_type="run.completed",
            payload={
                "output_revision_id": revision.id,
                "output_revision_hash": revision.content_hash,
            },
        )
        self.repository.commit()
        return run
