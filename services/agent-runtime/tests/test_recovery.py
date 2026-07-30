from fastapi.testclient import TestClient

from open_publisher_runtime.config import Settings
from open_publisher_runtime.domain.entities import PublishAttempt, RuntimeEvent, WorkflowRun
from open_publisher_runtime.domain.enums import (
    ApprovalStatus,
    PublishJobState,
    PublishOperation,
    PublishPlanStatus,
    RunStatus,
)
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.main import create_app

TEST_TOKEN = "test-open-publisher-recovery-token-0001"


def _client(app) -> TestClient:
    return TestClient(
        app,
        headers={"Authorization": f"Bearer {TEST_TOKEN}"},
    )


def test_startup_recovers_interrupted_publish_claim_as_unknown(
    tmp_path,
    article_payload,
) -> None:
    settings = Settings(
        data_dir=tmp_path / "runtime-data",
        api_token=TEST_TOKEN,
    )
    first_app = create_app(settings)
    with _client(first_app) as client:
        article = client.post("/api/v1/articles", json=article_payload).json()
        created_plan = client.post(
            "/api/v1/publish/plans",
            json={
                "revision_id": article["revision"]["id"],
                "targets": [{"platform": "wechat", "account_ref": "restart-test"}],
            },
        ).json()
        plan_id = created_plan["plan"]["id"]
        client.post(
            f"/api/v1/publish/plans/{plan_id}/approve",
            json={"actor_id": "user:restart-test"},
        )
        job_id = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue").json()[
            "jobs"
        ][0]["id"]

        with first_app.state.container.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            assert repository.claim_publish_job(
                job_id,
                expected_states=[PublishJobState.PENDING],
                claimed_state=PublishJobState.IN_PROGRESS,
            )
            repository.add_publish_attempt(
                PublishAttempt(
                    job_id=job_id,
                    attempt_number=1,
                    operation=PublishOperation.DRY_RUN,
                    request_json={"mode": "dry_run"},
                )
            )
            plan = repository.get_publish_plan(plan_id)
            assert plan is not None
            plan.status = PublishPlanStatus.RUNNING
            repository.update_publish_plan(plan)

    second_app = create_app(settings)
    with _client(second_app) as client:
        detail = client.get(f"/api/v1/publish/plans/{plan_id}")
        assert detail.status_code == 200, detail.text
        payload = detail.json()
        assert payload["plan"]["status"] == "needs_attention"
        assert payload["jobs"][0]["state"] == "unknown"
        assert payload["jobs"][0]["reconcile_required"] is True
        assert "reconciliation required" in payload["jobs"][0]["last_error"]

        with second_app.state.container.database.session() as session:
            attempts = SqlAlchemyRuntimeRepository(session).list_publish_attempts(job_id)
        assert len(attempts) == 1
        assert attempts[0].state.value == "unknown"
        assert attempts[0].completed_at is not None


def test_startup_marks_interrupted_workflow_failed_without_mutating_input(
    tmp_path,
    article_payload,
) -> None:
    settings = Settings(
        data_dir=tmp_path / "runtime-data",
        api_token=TEST_TOKEN,
    )
    first_app = create_app(settings)
    with _client(first_app) as client:
        article = client.post("/api/v1/articles", json=article_payload).json()
        workflow = client.get("/api/v1/workflows").json()[0]
        run = WorkflowRun(
            workflow_id=workflow["id"],
            article_id=article["article"]["id"],
            input_revision_id=article["revision"]["id"],
            status=RunStatus.RUNNING,
            approval_status=ApprovalStatus.NOT_REQUIRED,
            workflow_snapshot_json={
                "workflow_id": workflow["id"],
                "version": workflow["version"],
            },
            state_json={
                "budget": {
                    "model_calls_limit": 8,
                    "model_calls_reserved": 7,
                    "model_calls_used": 0,
                    "max_parallel": 4,
                    "max_wall_clock_seconds": 300,
                }
            },
        )
        with first_app.state.container.database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            repository.add_run(run)
            repository.add_event(
                RuntimeEvent(
                    run_id=run.id,
                    aggregate_type="workflow_run",
                    aggregate_id=run.id,
                    event_type="run.started",
                )
            )

    second_app = create_app(settings)
    with _client(second_app) as client:
        detail = client.get(f"/api/v1/runs/{run.id}")
        assert detail.status_code == 200, detail.text
        payload = detail.json()
        assert payload["run"]["status"] == "failed"
        assert payload["run"]["output_revision_id"] is None
        assert payload["run"]["input_revision_id"] == article["revision"]["id"]
        assert payload["run"]["state_json"]["budget"]["model_calls_used"] == 0
        assert "RuntimeRestart" in payload["run"]["error"]
        assert payload["events"][-1]["event_type"] == "run.failed"
        assert payload["events"][-1]["payload_json"] == {
            "error_type": "RuntimeRestart",
            "recovered_on_startup": True,
        }
