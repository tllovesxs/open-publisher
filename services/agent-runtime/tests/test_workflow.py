from sqlalchemy import select

from open_publisher_runtime.infrastructure.orm import WorkflowRunORM
from open_publisher_runtime.infrastructure.providers import MockTextProvider


class CountingTextProvider(MockTextProvider):
    def __init__(self, callback=None) -> None:
        self.calls = 0
        self.callback = callback

    def generate(self, request):
        self.calls += 1
        if self.callback:
            self.callback()
        return super().generate(request)


def test_preset_workflow_runs_with_deterministic_mock(client, article_payload) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflows_response = client.get("/api/v1/workflows")
    assert workflows_response.status_code == 200
    workflows = workflows_response.json()
    assert workflows

    run_response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflows[0]["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "topic": "确定性 mock 工作流",
            "policy": {"require_content_approval": False},
        },
    )
    assert run_response.status_code == 201, run_response.text
    run = run_response.json()
    assert run["status"] == "completed"
    assert run["output_revision_id"]
    assert run["state_json"]["engine"] in {"langgraph", "sequential-fallback"}
    assert run["state_json"]["review_artifact_id"]

    detail = client.get(f"/api/v1/runs/{run['id']}")
    assert detail.status_code == 200
    event_types = [event["event_type"] for event in detail.json()["events"]]
    assert event_types == ["run.queued", "run.started", "run.completed"]


def test_run_can_pause_and_resume_for_approval(client, article_payload) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]
    waiting = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {"require_content_approval": True},
        },
    ).json()
    assert waiting["status"] == "waiting_approval"
    assert waiting["interrupt_json"]["type"] == "content_approval"

    resumed = client.post(
        f"/api/v1/runs/{waiting['id']}/resume",
        json={"action": "approve", "comment": "演示审批"},
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "completed"


def test_run_policy_rejects_insufficient_model_budget_before_first_call(
    client, article_payload
) -> None:
    provider = CountingTextProvider()
    client.app.state.container.model_access.text_provider = provider
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {"max_model_calls": 1},
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert "model-call budget" in response.json()["error"]
    assert provider.calls == 0


def test_running_claim_is_committed_before_model_io(client, article_payload) -> None:
    observed_states: list[str] = []

    def observe_persisted_run() -> None:
        with client.app.state.container.database.session() as session:
            observed_states.extend(
                session.scalars(select(WorkflowRunORM.status)).all()
            )

    provider = CountingTextProvider(observe_persisted_run)
    client.app.state.container.model_access.text_provider = provider
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {"max_model_calls": 3},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "completed"
    assert provider.calls == 3
    assert observed_states == ["running", "running", "running"]
