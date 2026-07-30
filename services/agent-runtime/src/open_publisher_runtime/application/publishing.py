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

P0_RISK_POLICY_VERSION = "p0-dry-run-risk.v1"


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
                "idempotency_key": job.idempotency_key,
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
                "idempotency_key": job.idempotency_key,
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

    def recover_interrupted_jobs(self) -> list[PublishJob]:
        interrupted = list(
            self.repository.list_publish_jobs_by_states(
                [PublishJobState.IN_PROGRESS, PublishJobState.RECONCILING]
            )
        )
        affected_plan_ids: set[str] = set()
        for job in interrupted:
            affected_plan_ids.add(job.plan_id)
            receipt = self.repository.get_publish_receipt_for_job(job.id)
            if receipt is not None:
                job.state = PublishJobState.SUCCEEDED
                job.remote_id = receipt.remote_id
                job.reconcile_required = False
                job.last_error = None
                job.updated_at = utc_now()
                self.repository.update_publish_job(job)
                continue

            for attempt in self.repository.list_publish_attempts(job.id):
                if attempt.state is PublishAttemptState.IN_PROGRESS:
                    attempt.state = PublishAttemptState.UNKNOWN
                    attempt.error = (
                        "runtime stopped before the external operation outcome was recorded"
                    )
                    attempt.completed_at = utc_now()
                    self.repository.update_publish_attempt(attempt)
            job.state = PublishJobState.UNKNOWN
            job.reconcile_required = True
            job.last_error = (
                "runtime restarted during an external operation; reconciliation required"
            )
            job.updated_at = utc_now()
            self.repository.update_publish_job(job)

        for plan_id in affected_plan_ids:
            self._refresh_plan(plan_id)
        if interrupted:
            self.repository.commit()
        return interrupted

    def create_plan(
        self,
        *,
        revision_id: str,
        targets: list[PublishTarget],
        selected_asset_ids: list[str] | None = None,
    ) -> tuple[PublishPlan, list[PlatformVariant]]:
        revision = self.repository.get_revision(revision_id)
        if revision is None:
            raise LookupError(f"revision {revision_id} not found")
        article = self.repository.get_article(revision.article_id)
        if article is None:
            raise LookupError(f"article {revision.article_id} not found")
        if not targets:
            raise ValueError("publish plan requires at least one target")
        normalized_asset_ids = [
            asset_id.strip() for asset_id in (selected_asset_ids or [])
        ]
        if any(not asset_id for asset_id in normalized_asset_ids):
            raise ValueError("selected asset ids cannot be blank")
        if len(normalized_asset_ids) != len(set(normalized_asset_ids)):
            raise ValueError("selected asset ids must be unique")
        selected_asset_hashes: list[str] = []
        for artifact_id in normalized_asset_ids:
            artifact = self.repository.get_artifact(artifact_id)
            if artifact is None:
                raise LookupError(f"selected asset {artifact_id} not found")
            selected_asset_hashes.append(artifact.content_hash)

        variants: list[PlatformVariant] = []
        for target in targets:
            platform = target.platform.strip().lower()
            account_ref = target.account_ref.strip()
            title = (target.title or article.title).strip()
            if not platform or not account_ref or not title:
                raise ValueError("publish target platform, account, and title cannot be blank")
            if target.connection_profile_id:
                profile = self.repository.get_connection(target.connection_profile_id)
                if profile is None:
                    raise LookupError(
                        f"connection profile {target.connection_profile_id} not found"
                    )
            rendered = self._render_variant(
                platform=platform,
                title=title,
                markdown=revision.markdown,
            )
            artifact = self.artifact_service.put_text(
                kind=f"platform-variant.{platform}",
                text=rendered,
                media_type="text/markdown; charset=utf-8",
                metadata={
                    "revision_id": revision.id,
                    "platform": platform,
                    "account_ref": account_ref,
                },
            )
            variant = PlatformVariant(
                revision_id=revision.id,
                platform=platform,
                account_ref=account_ref,
                title=title,
                body_artifact_id=artifact.id,
                content_hash=artifact.content_hash,
                metadata_json={
                    **target.metadata,
                    "producer": "deterministic-platform-transform.v1",
                    "connection_profile_id": target.connection_profile_id,
                    "simulate_outcome": target.simulate_outcome,
                },
            )
            variant.metadata_json["target_hash"] = self._target_hash(variant)
            variants.append(self.repository.add_variant(variant))

        plan = PublishPlan(
            revision_id=revision.id,
            status=PublishPlanStatus.DRAFT,
            approval_status=ApprovalStatus.PENDING,
            plan_json={
                "mode": "dry_run",
                "requested_operation": PublishOperation.DRY_RUN.value,
                "risk_policy_version": P0_RISK_POLICY_VERSION,
                "selected_asset_ids": normalized_asset_ids,
                "selected_asset_hashes": selected_asset_hashes,
                "variant_ids": [variant.id for variant in variants],
                "target_hashes": [
                    str(variant.metadata_json["target_hash"]) for variant in variants
                ],
                "remote_publish_allowed": False,
            },
        )
        return self.repository.add_publish_plan(plan), variants

    @staticmethod
    def _hash_json(value: object) -> str:
        serialized = json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(serialized).hexdigest()

    @classmethod
    def _target_hash(cls, variant: PlatformVariant) -> str:
        approval_metadata = {
            key: value
            for key, value in variant.metadata_json.items()
            if key != "target_hash"
        }
        return cls._hash_json(
            {
                "variant_id": variant.id,
                "revision_id": variant.revision_id,
                "platform": variant.platform,
                "account_ref": variant.account_ref,
                "connection_profile_id": variant.metadata_json.get("connection_profile_id"),
                "title": variant.title,
                "content_hash": variant.content_hash,
                "metadata": approval_metadata,
            }
        )

    def _approval_binding(self, plan: PublishPlan) -> dict[str, object]:
        revision = self.repository.get_revision(plan.revision_id)
        if revision is None:
            raise LookupError(f"revision {plan.revision_id} not found")
        target_hashes: list[str] = []
        for variant_id in plan.plan_json.get("variant_ids", []):
            variant = self.repository.get_variant(str(variant_id))
            if variant is None:
                raise LookupError(f"platform variant {variant_id} not found")
            if variant.revision_id != revision.id:
                raise ValueError("publish plan contains a variant from another revision")
            target_hashes.append(self._target_hash(variant))
        if not target_hashes:
            raise ValueError("publish plan has no targets to approve")
        requested_operation = str(plan.plan_json.get("requested_operation") or "")
        if requested_operation != PublishOperation.DRY_RUN.value:
            raise ValueError("the P0 publisher only supports the dry_run operation")
        risk_policy_version = str(plan.plan_json.get("risk_policy_version") or "")
        if not risk_policy_version:
            raise ValueError("publish plan risk policy version is missing")
        selected_asset_ids = plan.plan_json.get("selected_asset_ids", [])
        selected_asset_hashes = plan.plan_json.get("selected_asset_hashes", [])
        if (
            not isinstance(selected_asset_ids, list)
            or any(not isinstance(value, str) or not value for value in selected_asset_ids)
            or len(selected_asset_ids) != len(set(selected_asset_ids))
        ):
            raise ValueError("publish plan selected asset ids are invalid")
        if not isinstance(selected_asset_hashes, list):
            raise ValueError("publish plan selected asset hashes are invalid")
        current_asset_hashes: list[str] = []
        for artifact_id in selected_asset_ids:
            artifact = self.repository.get_artifact(artifact_id)
            if artifact is None:
                raise LookupError(f"selected asset {artifact_id} not found")
            current_asset_hashes.append(artifact.content_hash)
        if selected_asset_hashes != current_asset_hashes:
            raise ValueError("publish plan selected assets changed after plan creation")
        binding = {
            "revision_id": revision.id,
            "revision_hash": revision.content_hash,
            "target_hashes": target_hashes,
            "selected_asset_hashes": current_asset_hashes,
            "requested_operation": requested_operation,
            "risk_policy_version": risk_policy_version,
        }
        return {
            **binding,
            "binding_hash": self._hash_json(binding),
        }

    def approve(
        self,
        plan_id: str,
        *,
        actor_id: str,
        comment: str | None = None,
        source: str = "user",
    ) -> PublishPlan:
        plan = self.repository.get_publish_plan(plan_id)
        if plan is None:
            raise LookupError(f"publish plan {plan_id} not found")
        normalized_actor = actor_id.strip()
        if not normalized_actor:
            raise ValueError("publish approval actor cannot be blank")
        if plan.status not in {PublishPlanStatus.DRAFT, PublishPlanStatus.APPROVED}:
            raise ValueError(f"publish plan cannot be approved from state {plan.status}")
        binding = self._approval_binding(plan)
        plan.plan_json = {
            **plan.plan_json,
            "approval_grant": {
                **binding,
                "actor_id": normalized_actor,
                "approved_at": utc_now().isoformat(),
                "comment": comment or "",
                "source": source,
            },
        }
        plan.status = PublishPlanStatus.APPROVED
        plan.approval_status = ApprovalStatus.APPROVED
        plan.updated_at = utc_now()
        return self.repository.update_publish_plan(plan)

    def _validate_approval(self, plan: PublishPlan) -> None:
        if plan.approval_status is not ApprovalStatus.APPROVED:
            raise ValueError("publish plan must be explicitly approved before enqueue")
        grant = plan.plan_json.get("approval_grant")
        if not isinstance(grant, dict):
            raise ValueError("publish plan approval grant is missing")
        current_binding = self._approval_binding(plan)
        for key, expected_value in current_binding.items():
            if grant.get(key) != expected_value:
                raise ValueError("publish plan content changed after approval")

    @staticmethod
    def _job_payload(variant: PlatformVariant) -> dict[str, object]:
        return {
            "mode": "dry_run",
            "variant_id": variant.id,
            "content_hash": variant.content_hash,
            "simulate_outcome": variant.metadata_json.get("simulate_outcome", "success"),
        }

    @staticmethod
    def _payload_hash(payload: dict[str, object]) -> str:
        payload_bytes = json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        return hashlib.sha256(payload_bytes).hexdigest()

    @staticmethod
    def _idempotency_key(
        *,
        plan_id: str,
        variant: PlatformVariant,
        payload_hash: str,
    ) -> str:
        return hashlib.sha256(
            (
                f"dry-run-v1:{plan_id}:{variant.id}:{variant.platform}:"
                f"{variant.account_ref}:{payload_hash}"
            ).encode()
        ).hexdigest()

    def _validate_job_execution(self, job: PublishJob) -> PlatformVariant:
        plan = self.repository.get_publish_plan(job.plan_id)
        if plan is None:
            raise LookupError(f"publish plan {job.plan_id} not found")
        self._validate_approval(plan)
        variant_ids = [str(value) for value in plan.plan_json.get("variant_ids", [])]
        if job.variant_id not in variant_ids:
            raise ValueError("publish job variant is no longer part of its approved plan")
        variant = self.repository.get_variant(job.variant_id)
        if variant is None:
            raise LookupError(f"platform variant {job.variant_id} not found")

        expected_payload = self._job_payload(variant)
        expected_payload_hash = self._payload_hash(expected_payload)
        expected_idempotency_key = self._idempotency_key(
            plan_id=plan.id,
            variant=variant,
            payload_hash=expected_payload_hash,
        )
        expected_connection_id = variant.metadata_json.get("connection_profile_id")
        if (
            job.operation is not PublishOperation.DRY_RUN
            or job.platform != variant.platform
            or job.account_ref != variant.account_ref
            or job.connection_profile_id != expected_connection_id
            or job.payload_json != expected_payload
            or job.payload_hash != expected_payload_hash
            or job.idempotency_key != expected_idempotency_key
        ):
            raise ValueError("publish job changed after its approved plan was enqueued")
        return variant

    @staticmethod
    def _render_variant(*, platform: str, title: str, markdown: str) -> str:
        platform_name = platform.strip().lower()
        header = f"<!-- open-publisher variant:{platform_name} -->"
        return f"{header}\n\n{markdown.strip()}\n"

    def enqueue(self, plan_id: str) -> list[PublishJob]:
        plan = self.repository.get_publish_plan(plan_id)
        if plan is None:
            raise LookupError(f"publish plan {plan_id} not found")
        self._validate_approval(plan)
        existing_jobs = list(self.repository.list_publish_jobs(plan.id))
        if plan.status is PublishPlanStatus.COMPLETED:
            return existing_jobs
        variant_ids = [str(value) for value in plan.plan_json.get("variant_ids", [])]
        jobs: list[PublishJob] = []
        for variant_id in variant_ids:
            variant = self.repository.get_variant(variant_id)
            if variant is None:
                raise LookupError(f"platform variant {variant_id} not found")
            payload = self._job_payload(variant)
            payload_hash = self._payload_hash(payload)
            idempotency_key = self._idempotency_key(
                plan_id=plan.id,
                variant=variant,
                payload_hash=payload_hash,
            )
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
        self._refresh_plan(plan.id)
        return jobs

    def process(self, job_id: str) -> tuple[PublishJob, PublishReceipt | None]:
        job = self.repository.get_publish_job(job_id)
        if job is None:
            raise LookupError(f"publish job {job_id} not found")
        existing_receipt = self.repository.get_publish_receipt_for_job(job.id)
        if job.state is PublishJobState.SUCCEEDED and existing_receipt:
            self._refresh_plan(job.plan_id)
            self.repository.commit()
            return job, existing_receipt
        if job.state is PublishJobState.UNKNOWN:
            raise ValueError("UNKNOWN jobs must be reconciled before retry")
        if job.state not in {PublishJobState.PENDING, PublishJobState.FAILED_RETRYABLE}:
            raise ValueError(f"publish job cannot be processed from state {job.state}")
        variant = self._validate_job_execution(job)

        claimed = self.repository.claim_publish_job(
            job.id,
            expected_states=[PublishJobState.PENDING, PublishJobState.FAILED_RETRYABLE],
            claimed_state=PublishJobState.IN_PROGRESS,
        )
        if not claimed:
            current = self.repository.get_publish_job(job.id)
            if current is not None and current.state is PublishJobState.SUCCEEDED:
                receipt = self.repository.get_publish_receipt_for_job(current.id)
                if receipt is not None:
                    return current, receipt
            current_state = current.state if current is not None else "missing"
            raise ValueError(f"publish job claim failed from state {current_state}")
        job = self.repository.get_publish_job(job.id)
        assert job is not None
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
        self._refresh_plan(job.plan_id)
        # Persist the exclusive claim and attempt before any publisher I/O.
        self.repository.commit()

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
            self.repository.commit()
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
            self.repository.commit()
            return job, None
        except Exception as error:  # noqa: BLE001 - outcome is uncertain after publisher entry
            attempt.state = PublishAttemptState.UNKNOWN
            attempt.error = f"unexpected publisher error: {type(error).__name__}"
            attempt.completed_at = utc_now()
            self.repository.update_publish_attempt(attempt)
            job.state = PublishJobState.UNKNOWN
            job.reconcile_required = True
            job.last_error = "unexpected publisher error; reconciliation required"
            job.updated_at = utc_now()
            self.repository.update_publish_job(job)
            self._refresh_plan(job.plan_id)
            self.repository.commit()
            return job, None

        receipt = self._succeed(job=job, attempt=attempt, variant=variant, result=result)
        self.repository.commit()
        return job, receipt

    def reconcile(self, job_id: str) -> tuple[PublishJob, PublishReceipt | None]:
        job = self.repository.get_publish_job(job_id)
        if job is None:
            raise LookupError(f"publish job {job_id} not found")
        if job.state is PublishJobState.SUCCEEDED:
            return job, self.repository.get_publish_receipt_for_job(job.id)
        if job.state is not PublishJobState.UNKNOWN:
            raise ValueError("only UNKNOWN publish jobs can be reconciled")
        variant = self._validate_job_execution(job)

        claimed = self.repository.claim_publish_job(
            job.id,
            expected_states=[PublishJobState.UNKNOWN],
            claimed_state=PublishJobState.RECONCILING,
        )
        if not claimed:
            current = self.repository.get_publish_job(job.id)
            if current is not None and current.state is PublishJobState.SUCCEEDED:
                return current, self.repository.get_publish_receipt_for_job(current.id)
            current_state = current.state if current is not None else "missing"
            raise ValueError(f"publish reconciliation claim failed from state {current_state}")
        job = self.repository.get_publish_job(job.id)
        assert job is not None
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
        self._refresh_plan(job.plan_id)
        # Reconciliation is I/O too; make its claim durable first.
        self.repository.commit()
        try:
            result = self.publisher.reconcile(job, variant)
        except Exception as error:  # noqa: BLE001 - keep the job reconcilable
            result = None
            attempt.error = f"reconciliation error: {type(error).__name__}"
        if result is None:
            attempt.state = PublishAttemptState.UNKNOWN
            attempt.error = (
                attempt.error or "simulated reconciliation could not determine remote state"
            )
            attempt.completed_at = utc_now()
            self.repository.update_publish_attempt(attempt)
            job.state = PublishJobState.UNKNOWN
            job.reconcile_required = True
            job.last_error = attempt.error
            job.updated_at = utc_now()
            self.repository.update_publish_job(job)
            self._refresh_plan(job.plan_id)
            self.repository.commit()
            return job, None
        receipt = self._succeed(job=job, attempt=attempt, variant=variant, result=result)
        self.repository.commit()
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
        elif any(
            job.state in {PublishJobState.IN_PROGRESS, PublishJobState.RECONCILING}
            for job in jobs
        ):
            plan.status = PublishPlanStatus.RUNNING
        else:
            plan.status = PublishPlanStatus.QUEUED
        plan.updated_at = utc_now()
        self.repository.update_publish_plan(plan)
