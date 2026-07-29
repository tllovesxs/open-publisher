from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from open_publisher_runtime.domain.entities import (
    Article,
    ArticleRevision,
    Artifact,
    ConnectionProfile,
    DomainModel,
    PlatformVariant,
    PublishAttempt,
    PublishJob,
    PublishPlan,
    PublishReceipt,
    RuntimeEvent,
    Workflow,
    WorkflowRun,
)
from open_publisher_runtime.infrastructure.orm import (
    ArticleORM,
    ArticleRevisionORM,
    ArtifactORM,
    ConnectionProfileORM,
    PlatformVariantORM,
    PublishAttemptORM,
    PublishJobORM,
    PublishPlanORM,
    PublishReceiptORM,
    RuntimeEventORM,
    WorkflowORM,
    WorkflowRunORM,
)


def _domain[DomainT: DomainModel](model: type[DomainT], orm_object: Any) -> DomainT:
    return model.model_validate(orm_object)


def _values(model: DomainModel) -> dict[str, Any]:
    return model.model_dump(mode="python")


class SqlAlchemyRuntimeRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def _add[DomainT: DomainModel](
        self, orm_type: type[Any], domain_model: DomainT
    ) -> DomainT:
        orm_object = orm_type(**_values(domain_model))
        self.session.add(orm_object)
        self.session.flush()
        return domain_model

    def _update[DomainT: DomainModel](
        self, orm_type: type[Any], domain_model: DomainT
    ) -> DomainT:
        orm_object = self.session.get(orm_type, domain_model.id)
        if orm_object is None:
            raise LookupError(f"{orm_type.__name__} {domain_model.id} not found")
        for key, value in _values(domain_model).items():
            setattr(orm_object, key, value)
        self.session.flush()
        return domain_model

    def add_article(self, article: Article) -> Article:
        return self._add(ArticleORM, article)

    def get_article(self, article_id: str) -> Article | None:
        obj = self.session.get(ArticleORM, article_id)
        return _domain(Article, obj) if obj else None

    def list_articles(self) -> Sequence[Article]:
        objects = self.session.scalars(select(ArticleORM).order_by(ArticleORM.created_at)).all()
        return [_domain(Article, obj) for obj in objects]

    def add_revision(self, revision: ArticleRevision) -> ArticleRevision:
        return self._add(ArticleRevisionORM, revision)

    def get_revision(self, revision_id: str) -> ArticleRevision | None:
        obj = self.session.get(ArticleRevisionORM, revision_id)
        return _domain(ArticleRevision, obj) if obj else None

    def get_latest_revision(self, article_id: str) -> ArticleRevision | None:
        obj = self.session.scalar(
            select(ArticleRevisionORM)
            .where(ArticleRevisionORM.article_id == article_id)
            .order_by(ArticleRevisionORM.number.desc())
            .limit(1)
        )
        return _domain(ArticleRevision, obj) if obj else None

    def list_revisions(self, article_id: str) -> Sequence[ArticleRevision]:
        objects = self.session.scalars(
            select(ArticleRevisionORM)
            .where(ArticleRevisionORM.article_id == article_id)
            .order_by(ArticleRevisionORM.number)
        ).all()
        return [_domain(ArticleRevision, obj) for obj in objects]

    def next_revision_number(self, article_id: str) -> int:
        value = self.session.scalar(
            select(func.max(ArticleRevisionORM.number)).where(
                ArticleRevisionORM.article_id == article_id
            )
        )
        return int(value or 0) + 1

    def add_artifact(self, artifact: Artifact) -> Artifact:
        return self._add(ArtifactORM, artifact)

    def get_artifact(self, artifact_id: str) -> Artifact | None:
        obj = self.session.get(ArtifactORM, artifact_id)
        return _domain(Artifact, obj) if obj else None

    def get_artifact_by_hash(self, content_hash: str) -> Artifact | None:
        obj = self.session.scalar(
            select(ArtifactORM).where(ArtifactORM.content_hash == content_hash)
        )
        return _domain(Artifact, obj) if obj else None

    def add_workflow(self, workflow: Workflow) -> Workflow:
        return self._add(WorkflowORM, workflow)

    def get_workflow(self, workflow_id: str) -> Workflow | None:
        obj = self.session.get(WorkflowORM, workflow_id)
        return _domain(Workflow, obj) if obj else None

    def find_workflow(self, name: str, version: str) -> Workflow | None:
        obj = self.session.scalar(
            select(WorkflowORM).where(
                WorkflowORM.name == name,
                WorkflowORM.version == version,
            )
        )
        return _domain(Workflow, obj) if obj else None

    def list_workflows(self) -> Sequence[Workflow]:
        objects = self.session.scalars(
            select(WorkflowORM).order_by(WorkflowORM.name, WorkflowORM.version)
        ).all()
        return [_domain(Workflow, obj) for obj in objects]

    def add_run(self, run: WorkflowRun) -> WorkflowRun:
        return self._add(WorkflowRunORM, run)

    def update_run(self, run: WorkflowRun) -> WorkflowRun:
        return self._update(WorkflowRunORM, run)

    def get_run(self, run_id: str) -> WorkflowRun | None:
        obj = self.session.get(WorkflowRunORM, run_id)
        return _domain(WorkflowRun, obj) if obj else None

    def add_event(self, event: RuntimeEvent) -> RuntimeEvent:
        return self._add(RuntimeEventORM, event)

    def list_events(self, run_id: str) -> Sequence[RuntimeEvent]:
        objects = self.session.scalars(
            select(RuntimeEventORM)
            .where(RuntimeEventORM.run_id == run_id)
            .order_by(RuntimeEventORM.created_at, RuntimeEventORM.id)
        ).all()
        return [_domain(RuntimeEvent, obj) for obj in objects]

    def add_connection(self, profile: ConnectionProfile) -> ConnectionProfile:
        return self._add(ConnectionProfileORM, profile)

    def get_connection(self, profile_id: str) -> ConnectionProfile | None:
        obj = self.session.get(ConnectionProfileORM, profile_id)
        return _domain(ConnectionProfile, obj) if obj else None

    def list_connections(self) -> Sequence[ConnectionProfile]:
        objects = self.session.scalars(
            select(ConnectionProfileORM).order_by(ConnectionProfileORM.name)
        ).all()
        return [_domain(ConnectionProfile, obj) for obj in objects]

    def add_variant(self, variant: PlatformVariant) -> PlatformVariant:
        return self._add(PlatformVariantORM, variant)

    def get_variant(self, variant_id: str) -> PlatformVariant | None:
        obj = self.session.get(PlatformVariantORM, variant_id)
        return _domain(PlatformVariant, obj) if obj else None

    def list_variants_for_revision(self, revision_id: str) -> Sequence[PlatformVariant]:
        objects = self.session.scalars(
            select(PlatformVariantORM)
            .where(PlatformVariantORM.revision_id == revision_id)
            .order_by(PlatformVariantORM.created_at)
        ).all()
        return [_domain(PlatformVariant, obj) for obj in objects]

    def add_publish_plan(self, plan: PublishPlan) -> PublishPlan:
        return self._add(PublishPlanORM, plan)

    def update_publish_plan(self, plan: PublishPlan) -> PublishPlan:
        return self._update(PublishPlanORM, plan)

    def get_publish_plan(self, plan_id: str) -> PublishPlan | None:
        obj = self.session.get(PublishPlanORM, plan_id)
        return _domain(PublishPlan, obj) if obj else None

    def add_publish_job(self, job: PublishJob) -> PublishJob:
        return self._add(PublishJobORM, job)

    def update_publish_job(self, job: PublishJob) -> PublishJob:
        return self._update(PublishJobORM, job)

    def get_publish_job(self, job_id: str) -> PublishJob | None:
        obj = self.session.get(PublishJobORM, job_id)
        return _domain(PublishJob, obj) if obj else None

    def get_publish_job_by_idempotency(self, idempotency_key: str) -> PublishJob | None:
        obj = self.session.scalar(
            select(PublishJobORM).where(PublishJobORM.idempotency_key == idempotency_key)
        )
        return _domain(PublishJob, obj) if obj else None

    def list_publish_jobs(self, plan_id: str) -> Sequence[PublishJob]:
        objects = self.session.scalars(
            select(PublishJobORM)
            .where(PublishJobORM.plan_id == plan_id)
            .order_by(PublishJobORM.created_at, PublishJobORM.id)
        ).all()
        return [_domain(PublishJob, obj) for obj in objects]

    def add_publish_attempt(self, attempt: PublishAttempt) -> PublishAttempt:
        return self._add(PublishAttemptORM, attempt)

    def update_publish_attempt(self, attempt: PublishAttempt) -> PublishAttempt:
        return self._update(PublishAttemptORM, attempt)

    def next_attempt_number(self, job_id: str) -> int:
        value = self.session.scalar(
            select(func.max(PublishAttemptORM.attempt_number)).where(
                PublishAttemptORM.job_id == job_id
            )
        )
        return int(value or 0) + 1

    def list_publish_attempts(self, job_id: str) -> Sequence[PublishAttempt]:
        objects = self.session.scalars(
            select(PublishAttemptORM)
            .where(PublishAttemptORM.job_id == job_id)
            .order_by(PublishAttemptORM.attempt_number)
        ).all()
        return [_domain(PublishAttempt, obj) for obj in objects]

    def add_publish_receipt(self, receipt: PublishReceipt) -> PublishReceipt:
        return self._add(PublishReceiptORM, receipt)

    def get_publish_receipt_for_job(self, job_id: str) -> PublishReceipt | None:
        obj = self.session.scalar(
            select(PublishReceiptORM).where(PublishReceiptORM.job_id == job_id)
        )
        return _domain(PublishReceipt, obj) if obj else None

    def commit(self) -> None:
        self.session.commit()

    def rollback(self) -> None:
        self.session.rollback()
