from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field

from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.ports import RuntimeRepository
from open_publisher_runtime.domain.entities import (
    PlatformVariant,
    PublishAttempt,
    PublishJob,
    PublishPlan,
    PublishReceipt,
    utc_now,
)
from open_publisher_runtime.domain.enums import (
    ApprovalStatus,
    PublishAttemptState,
    PublishJobState,
    PublishOperation,
    PublishPlanStatus,
)


class PublishTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    platform: str
    account_ref: str
    connection_profile_id: str | None = None
    title: str | None = None
    metadata: dict[str, object] = Field(default_factory=dict)
    simulate_outcome: str = "success"


@dataclass(frozen=True, slots=True)
class DryRunResult:
    remote_id: str
    remote_url: str | None
    details: dict[str, object]


class UnknownPublishOutcome(RuntimeError):
    pass


class DryRunPublishFailure(RuntimeError):
    def __init__(self, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class DeterministicDryRunPublisher:
    """A publisher that never contacts a platform."""

    def publish(self, job: PublishJob, variant: PlatformVariant) -> DryRunResult:
        outcome = str(job.payload_json.get("simulate_outcome", "success"))
        if outcome in {"unknown", "unknown_then_success"}:
            raise UnknownPublishOutcome("simulated timeout after an uncertain remote write")
        if outcome == "retryable_failure":
            raise DryRunPublishFailure("simulated transient failure", retryable=True)
        if outcome == "terminal_failure":
            raise DryRunPublishFailure("simulated terminal failure", retryable=False)
        remote_id = f"dry-{job.platform}-{job.id[:12]}"
        return DryRunResult(
            remote_id=remote_id,
            remote_url=None,
            details={
                "mode": "dry_run",
                "platform": job.platform,
                "account_ref": job.account_ref,
                "variant_id": variant.id,
                "notice": "No remote API was called.",
            },
        )

    def reconcile(self, job: PublishJob, variant: PlatformVariant) -> DryRunResult | None:
        outcome = str(job.payload_json.get("simulate_outcome", "success"))
        if outcome != "unknown_then_success":
            return None
        remote_id = f"dry-reconciled-{job.platform}-{job.id[:12]}"
        return DryRunResult(
            remote_id=remote_id,
            remote_url=None,
            details={
                "mode": "dry_run_reconcile",
                "platform": job.platform,
                "variant_id": variant.id,
                "notice": "Simulated reconciliation found the remote draft.",
            },
        )


class PublishOutboxService:
    def __init__(
        self,
        *,
        repository: RuntimeRepository,
        artifact_service: ArtifactService,
        publisher: DeterministicDryRunPublisher,
    ) -> None:
        self.repository = repository
        self.artifact_service = artifact_service
        self.publisher = publisher

    def create_plan(
        self,
        *,
        revision_id: str,
        targets: list[PublishTarget],
        approved: bool,
    ) -> tuple[PublishPlan, list[PlatformVariant]]:
        revision = self.repository.get_revision(revision_id)
        if revision is None:
            raise LookupError(f"revision {revision_id} not found")
        article = self.repository.get_article(revision.article_id)
        if article is None:
            raise LookupError(f"article {revision.article_id} not found")
        if not targets:
            raise ValueError("publish plan requires at least one target")

        variants: list[PlatformVariant] = []
        for target in targets:
            if target.connection_profile_id:
                profile = self.repository.get_connection(target.connection_profile_id)
                if profile is None:
                    raise LookupError(
                        f"connection profile {target.connection_profile_id} not found"
                    )
            rendered = self._render_variant(
                platform=target.platform,
                title=target.title or article.title,
                markdown=revision.markdown,
            )
            artifact = self.artifact_service.put_text(
                kind=f"platform-variant.{target.platform}",
                text=rendered,
                media_type="text/markdown; charset=utf-8",
                metadata={
                    "revision_id": revision.id,
                    "platform": target.platform,
                    "account_ref": target.account_ref,
                },
            )
            variant = PlatformVariant(
                revision_id=revision.id,
                platform=target.platform.strip().lower(),
                account_ref=target.account_ref,
                title=(target.title or article.title).strip(),
                body_artifact_id=artifact.id,
                content_hash=artifact.content_hash,
                metadata_json={
                    **target.metadata,
                    "connection_profile_id": target.connection_profile_id,
                    "simulate_outcome": target.simulate_outcome,
                },
            )
            variants.append(self.repository.add_variant(variant))

        plan = PublishPlan(
            revision_id=revision.id,
            status=PublishPlanStatus.APPROVED if approved else PublishPlanStatus.DRAFT,
            approval_status=ApprovalStatus.APPROVED if approved else ApprovalStatus.PENDING,
            plan_json={
                "mode": "dry_run",
                "variant_ids": [variant.id for variant in variants],
                "remote_publish_allowed": False,
            },
        )
        return self.repository.add_publish_plan(plan), variants

    @staticmethod
    def _render_variant(*, platform: str, title: str, markdown: str) -> str:
        platform_name = platform.strip().lower()
        header = f"<!-- open-publisher variant:{platform_name} -->"
        return f"{header}\n\n{markdown.strip()}\n"

    def enqueue(self, plan_id: str) -> list[PublishJob]:
        plan = self.repository.get_publish_plan(plan_id)
        if plan is None:
            raise LookupError(f"publish plan {plan_id} not found")
        if plan.approval_status is not ApprovalStatus.APPROVED:
            raise ValueError("publish plan must be approved before enqueue")
        variant_ids = [str(value) for value in plan.plan_json.get("variant_ids", [])]
        jobs: list[PublishJob] = []
        for variant_id in variant_ids:
            variant = self.repository.get_variant(variant_id)
            if variant is None:
                raise LookupError(f"platform variant {variant_id} not found")
            payload = {
                "mode": "dry_run",
                "variant_id": variant.id,
                "content_hash": variant.content_hash,
                "simulate_outcome": variant.metadata_json.get("simulate_outcome", "success"),
            }
            payload_bytes = json.dumps(
                payload,
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
            payload_hash = hashlib.sha256(payload_bytes).hexdigest()
            idempotency_key = hashlib.sha256(
                (
                    f"dry-run-v1:{plan.id}:{variant.id}:{variant.platform}:"
                    f"{variant.account_ref}:{payload_hash}"
                ).encode()
            ).hexdigest()
            existing = self.repository.get_publish_job_by_idempotency(idempotency_key)
            if existing:
                jobs.append(existing)
                continue
            job = PublishJob(
                plan_id=plan.id,
                variant_id=variant.id,
                connection_profile_id=variant.metadata_json.get("connection_profile_id"),
                platform=variant.platform,
                account_ref=variant.account_ref,
                idempotency_key=idempotency_key,
                payload_hash=payload_hash,
                payload_json=payload,
            )
            jobs.append(self.repository.add_publish_job(job))
        plan.status = PublishPlanStatus.QUEUED
        plan.updated_at = utc_now()
        self.repository.update_publish_plan(plan)
        return jobs

    def process(self, job_id: str) -> tuple[PublishJob, PublishReceipt | None]:
        job = self.repository.get_publish_job(job_id)
        if job is None:
            raise LookupError(f"publish job {job_id} not found")
        existing_receipt = self.repository.get_publish_receipt_for_job(job.id)
        if job.state is PublishJobState.SUCCEEDED and existing_receipt:
            return job, existing_receipt
        if job.state is PublishJobState.UNKNOWN:
            raise ValueError("UNKNOWN jobs must be reconciled before retry")
        if job.state not in {PublishJobState.PENDING, PublishJobState.FAILED_RETRYABLE}:
            raise ValueError(f"publish job cannot be processed from state {job.state}")
        variant = self.repository.get_variant(job.variant_id)
        if variant is None:
            raise LookupError(f"platform variant {job.variant_id} not found")

        attempt = PublishAttempt(
            job_id=job.id,
            attempt_number=self.repository.next_attempt_number(job.id),
            operation=PublishOperation.DRY_RUN,
            request_json={
                "payload_hash": job.payload_hash,
                "idempotency_key": job.idempotency_key,
                "mode": "dry_run",
            },
        )
        self.repository.add_publish_attempt(attempt)
        job.state = PublishJobState.IN_PROGRESS
        job.updated_at = utc_now()
        self.repository.update_publish_job(job)

        try:
            result = self.publisher.publish(job, variant)
        except UnknownPublishOutcome as error:
            attempt.state = PublishAttemptState.UNKNOWN
            attempt.error = str(error)
            attempt.completed_at = utc_now()
            self.repository.update_publish_attempt(attempt)
            job.state = PublishJobState.UNKNOWN
            job.reconcile_required = True
            job.last_error = str(error)
            job.updated_at = utc_now()
            self.repository.update_publish_job(job)
            self._refresh_plan(job.plan_id)
            return job, None
        except DryRunPublishFailure as error:
            attempt.state = PublishAttemptState.FAILED
            attempt.error = str(error)
            attempt.completed_at = utc_now()
            self.repository.update_publish_attempt(attempt)
            job.state = (
                PublishJobState.FAILED_RETRYABLE
                if error.retryable
                else PublishJobState.FAILED_TERMINAL
            )
            job.last_error = str(error)
            job.updated_at = utc_now()
            self.repository.update_publish_job(job)
            self._refresh_plan(job.plan_id)
            return job, None

        receipt = self._succeed(job=job, attempt=attempt, variant=variant, result=result)
        return job, receipt

    def reconcile(self, job_id: str) -> tuple[PublishJob, PublishReceipt | None]:
        job = self.repository.get_publish_job(job_id)
        if job is None:
            raise LookupError(f"publish job {job_id} not found")
        if job.state is PublishJobState.SUCCEEDED:
            return job, self.repository.get_publish_receipt_for_job(job.id)
        if job.state is not PublishJobState.UNKNOWN:
            raise ValueError("only UNKNOWN publish jobs can be reconciled")
        variant = self.repository.get_variant(job.variant_id)
        if variant is None:
            raise LookupError(f"platform variant {job.variant_id} not found")

        attempt = PublishAttempt(
            job_id=job.id,
            attempt_number=self.repository.next_attempt_number(job.id),
            operation=PublishOperation.RECONCILE,
            request_json={
                "remote_id": job.remote_id,
                "idempotency_key": job.idempotency_key,
                "mode": "dry_run",
            },
        )
        self.repository.add_publish_attempt(attempt)
        job.state = PublishJobState.RECONCILING
        job.updated_at = utc_now()
        self.repository.update_publish_job(job)
        result = self.publisher.reconcile(job, variant)
        if result is None:
            attempt.state = PublishAttemptState.UNKNOWN
            attempt.error = "simulated reconciliation could not determine remote state"
            attempt.completed_at = utc_now()
            self.repository.update_publish_attempt(attempt)
            job.state = PublishJobState.UNKNOWN
            job.reconcile_required = True
            job.last_error = attempt.error
            job.updated_at = utc_now()
            self.repository.update_publish_job(job)
            self._refresh_plan(job.plan_id)
            return job, None
        receipt = self._succeed(job=job, attempt=attempt, variant=variant, result=result)
        return job, receipt

    def _succeed(
        self,
        *,
        job: PublishJob,
        attempt: PublishAttempt,
        variant: PlatformVariant,
        result: DryRunResult,
    ) -> PublishReceipt:
        attempt.state = PublishAttemptState.SUCCEEDED
        attempt.response_json = {
            "remote_id": result.remote_id,
            "remote_url": result.remote_url,
            **result.details,
        }
        attempt.completed_at = utc_now()
        self.repository.update_publish_attempt(attempt)
        job.state = PublishJobState.SUCCEEDED
        job.remote_id = result.remote_id
        job.last_error = None
        job.reconcile_required = False
        job.updated_at = utc_now()
        self.repository.update_publish_job(job)
        receipt = PublishReceipt(
            job_id=job.id,
            status="dry_run_succeeded",
            remote_id=result.remote_id,
            remote_url=result.remote_url,
            content_hash=variant.content_hash,
            details_json=result.details,
        )
        existing = self.repository.get_publish_receipt_for_job(job.id)
        if existing:
            receipt = existing
        else:
            self.repository.add_publish_receipt(receipt)
        self._refresh_plan(job.plan_id)
        return receipt

    def _refresh_plan(self, plan_id: str) -> None:
        plan = self.repository.get_publish_plan(plan_id)
        if plan is None:
            return
        jobs = list(self.repository.list_publish_jobs(plan_id))
        if jobs and all(job.state is PublishJobState.SUCCEEDED for job in jobs):
            plan.status = PublishPlanStatus.COMPLETED
        elif any(
            job.state
            in {
                PublishJobState.UNKNOWN,
                PublishJobState.FAILED_TERMINAL,
                PublishJobState.FAILED_RETRYABLE,
            }
            for job in jobs
        ):
            plan.status = PublishPlanStatus.NEEDS_ATTENTION
        elif any(job.state is PublishJobState.IN_PROGRESS for job in jobs):
            plan.status = PublishPlanStatus.RUNNING
        else:
            plan.status = PublishPlanStatus.QUEUED
        plan.updated_at = utc_now()
        self.repository.update_publish_plan(plan)

