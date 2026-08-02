import json
import threading
import time
from contextlib import contextmanager
from urllib.parse import quote

import pytest
from sqlalchemy import select

import open_publisher_runtime.application.harness as harness_module
import open_publisher_runtime.workflows.preset as preset_module
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.model_access import TextGenerationResponse
from open_publisher_runtime.domain.entities import RuntimeEvent, Workflow, WorkflowRun
from open_publisher_runtime.domain.enums import RunStatus
from open_publisher_runtime.infrastructure.orm import ArtifactORM, WorkflowRunORM
from open_publisher_runtime.infrastructure.providers import MockTextProvider
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository


class CountingTextProvider(MockTextProvider):
    def __init__(self, callback=None) -> None:
        self.calls = 0
        self.callback = callback
        self.purposes: list[str] = []

    def generate(self, request):
        self.calls += 1
        self.purposes.append(request.purpose)
        if self.callback:
            self.callback()
        return super().generate(request)


class ConcurrencyTextProvider(MockTextProvider):
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.active = 0
        self.max_active = 0

    def generate(self, request):
        if request.purpose not in {"review", "risk", "visual"}:
            return super().generate(request)
        with self.lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            time.sleep(0.05)
            return super().generate(request)
        finally:
            with self.lock:
                self.active -= 1


class RecordingTextProvider(MockTextProvider):
    def __init__(self) -> None:
        self.requests = []

    def generate(self, request):
        self.requests.append(request)
        return super().generate(request)


class BlockingStreamingDraftProvider(MockTextProvider):
    def __init__(self) -> None:
        self.draft_delta_emitted = threading.Event()
        self.release_draft = threading.Event()

    def generate_stream(self, request, on_delta):
        assert request.purpose == "draft"
        first_delta = "# 流式正文\n\n" + "第一段内容。" * 48
        second_delta = "\n\n第二段内容。"
        on_delta(first_delta)
        self.draft_delta_emitted.set()
        assert self.release_draft.wait(timeout=5)
        on_delta(second_delta)
        return TextGenerationResponse(
            text=f"{first_delta}{second_delta}",
            provider="test-stream",
            model="test-stream",
        )


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
    assert run["state_json"]["engine"] in {
        "langgraph-customized",
        "sequential-customized",
    }
    assert run["state_json"]["enabled_node_ids"] == ["draft"]
    with client.app.state.container.database.session() as session:
        repository = SqlAlchemyRuntimeRepository(session)
        artifacts = ArtifactService(repository, client.app.state.container.blob_store)
        persisted = [
            repository.get_artifact(run["state_json"][key])
            for key in ("raw_draft_artifact_id", "risk_artifact_id")
        ]
        assert all(artifact is not None for artifact in persisted)
        assert {artifact.kind for artifact in persisted if artifact is not None} == {
            "workflow.raw-draft",
            "workflow.risk-report",
        }
        raw_draft = artifacts.read_text(run["state_json"]["raw_draft_artifact_id"])
        assert raw_draft

    detail = client.get(f"/api/v1/runs/{run['id']}")
    assert detail.status_code == 200
    events = detail.json()["events"]
    event_types = [event["event_type"] for event in events]
    assert event_types[:2] == ["run.queued", "run.started"]
    assert "run.budget_reserved" in event_types
    assert event_types[-1] == "run.completed"
    node_events = [
        (event["event_type"], event["payload_json"].get("node_id"))
        for event in events
        if event["event_type"].startswith("run.node_")
    ]
    started_nodes = {
        node_id
        for event_type, node_id in node_events
        if event_type == "run.node_started"
    }
    completed_nodes = {
        node_id
        for event_type, node_id in node_events
        if event_type == "run.node_completed"
    }
    assert started_nodes == {"draft", "reference-safety", "risk"}
    assert completed_nodes == started_nodes
    assert all(event_type != "run.node_failed" for event_type, _ in node_events)
    draft_checkpoints = [
        event
        for event in events
        if event["event_type"] == "run.node_output_checkpoint"
    ]
    assert draft_checkpoints
    assert all(event["payload_json"]["node_id"] == "draft" for event in draft_checkpoints)
    assert all(event["payload_json"]["markdown"] for event in draft_checkpoints)
    assert "".join(
        event["payload_json"]["markdown"] for event in draft_checkpoints
    ) == raw_draft
    assert not [
        event for event in events if event["event_type"] == "run.node_output_delta"
    ]
    assert run["state_json"]["budget"] == {
        "model_calls_limit": 8,
        "model_calls_reserved": 1,
        "model_calls_used": 1,
        "max_parallel": 4,
        "max_wall_clock_seconds": 300,
    }


def test_reference_template_keeps_source_private_and_applies_style_context(client) -> None:
    reference_source = (
        "# 参考文章\n\n独特原文表达不应出现在新文章里。\n\n"
        "## 原文案例\n\n原始案例细节。"
    )
    metadata = quote(
        json.dumps(
            {
                "source_fingerprint": "sha256:" + "a" * 64,
                "style_profile": {"tone": "直接、有判断"},
                "structure_profile": {"openingPattern": "先抛出误区"},
                "layout_profile": {"useLists": True},
                "content_atom_ledger": {"examples": ["原文案例"]},
                "phrase_blacklist": ["独特原文表达"],
            },
            ensure_ascii=False,
        )
    )
    seed = (
        "# 新文章\n\n## 创作要求\n\n- 主题：新的实践主题\n\n"
        f"<!-- open-publisher-reference-template:v1:{metadata} -->\n"
        "<open-publisher-reference-template-1>\n"
        f"{reference_source}\n"
        "</open-publisher-reference-template-1>"
    )
    provider = RecordingTextProvider()
    client.app.state.container.model_access.text_provider = provider
    article = client.post(
        "/api/v1/articles", json={"title": "新文章", "markdown": seed}
    ).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "topic": "新的实践主题",
            "policy": {
                "disabled_optional_node_ids": [
                    "research",
                    "outline",
                    "natural-style",
                    "review",
                    "visual",
                ]
            },
        },
    )

    assert response.status_code == 201, response.text
    draft_request = next(request for request in provider.requests if request.purpose == "draft")
    assert "<reference_article>" in draft_request.prompt
    assert reference_source in draft_request.prompt
    assert "open-publisher-reference-template:v1" not in draft_request.prompt
    output = response.json()
    with client.app.state.container.database.session() as session:
        repository = SqlAlchemyRuntimeRepository(session)
        artifacts = ArtifactService(repository, client.app.state.container.blob_store)
        final_markdown = artifacts.read_text(output["state_json"]["raw_draft_artifact_id"])
        risk_report = artifacts.read_text(output["state_json"]["risk_artifact_id"])
    assert "独特原文表达不应出现在新文章里" not in final_markdown
    assert "高保真参考检查" in risk_report


def test_active_run_endpoint_exposes_durable_node_activity(client, article_payload) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]
    with client.app.state.container.database.session() as session:
        repository = SqlAlchemyRuntimeRepository(session)
        run = repository.add_run(
            WorkflowRun(
                workflow_id=workflow["id"],
                article_id=article["article"]["id"],
                input_revision_id=article["revision"]["id"],
                status=RunStatus.RUNNING,
                workflow_snapshot_json={"version": "1.1.0"},
            )
        )
        repository.add_event(
            RuntimeEvent(
                run_id=run.id,
                aggregate_type="workflow_run",
                aggregate_id=run.id,
                event_type="run.node_started",
                payload_json={"node_id": "draft"},
            )
        )

    response = client.get(
        "/api/v1/runs/active",
        params={"article_id": article["article"]["id"]},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run"]["id"] == run.id
    assert payload["run"]["status"] == "running"
    assert len(payload["events"]) == 1
    assert payload["events"][0]["event_type"] == "run.node_started"
    assert payload["events"][0]["payload_json"] == {"node_id": "draft"}


def test_active_run_endpoint_exposes_live_draft_output_when_audit_write_is_unavailable(
    client, article_payload, monkeypatch: pytest.MonkeyPatch
) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]
    provider = BlockingStreamingDraftProvider()
    client.app.state.container.model_access.text_provider = provider

    @contextmanager
    def unavailable_progress_session():
        raise RuntimeError("simulated audit database lock")
        yield

    monkeypatch.setattr(
        client.app.state.container.database,
        "session",
        unavailable_progress_session,
    )
    response_box: dict[str, object] = {}

    def start_run() -> None:
        response_box["response"] = client.post(
            "/api/v1/runs",
            json={
                "workflow_id": workflow["id"],
                "article_id": article["article"]["id"],
                "revision_id": article["revision"]["id"],
            },
        )

    worker = threading.Thread(target=start_run)
    worker.start()
    assert provider.draft_delta_emitted.wait(timeout=5)

    active = client.get("/api/v1/runs/active", params={"article_id": article["article"]["id"]})

    assert active.status_code == 200, active.text
    events = active.json()["events"]
    assert any(event["event_type"] == "run.node_output_delta" for event in events)
    provider.release_draft.set()
    worker.join(timeout=5)
    assert not worker.is_alive()
    response = response_box.get("response")
    assert response is not None
    assert response.status_code == 201


def test_visual_agent_receives_selected_asset_text_metadata_only(
    client, article_payload
) -> None:
    provider = RecordingTextProvider()
    client.app.state.container.model_access.text_provider = provider
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {
                "disabled_optional_node_ids": [
                    "research",
                    "outline",
                    "natural-style",
                    "review",
                ],
                "visual_composition": {
                    "mode": "fixed",
                    "target_count": 1,
                    "assets": [
                        {
                            "id": "media-architecture",
                            "alt": "三层产品架构图",
                            "description": "展示采集、编排、发布三层之间的单向数据流。",
                        }
                    ],
                }
            },
        },
    )

    assert response.status_code == 201, response.text
    run = response.json()
    visual_request = next(
        request for request in provider.requests if request.purpose == "visual"
    )
    selection_request = next(
        request
        for request in provider.requests
        if request.purpose == "visual-material-selection"
    )
    assert "三层产品架构图" in selection_request.prompt
    assert "展示采集、编排、发布三层之间的单向数据流。" in selection_request.prompt
    assert "data:image" not in visual_request.prompt
    assert "data:image" not in selection_request.prompt
    assert visual_request.context["visual_composition"]["assets"][0]["id"] == "media-architecture"
    assert run["state_json"]["visual_composition_plan"]["placements"][0]["source"] in {
        "existing_asset",
        "generate",
    }
    assert "visual_outline_artifact_id" in run["state_json"]
    assert "visual_material_selection_artifact_id" in run["state_json"]
    assert "visual_prompts_artifact_id" in run["state_json"]


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
            "policy": {
                "disabled_optional_node_ids": [
                    "research", "outline", "natural-style", "review",
                ],
                "max_model_calls": 1,
            },
        },
    )
    assert response.status_code == 201
    assert response.json()["status"] == "failed"
    assert "model-call budget" in response.json()["error"]
    assert provider.calls == 0


def test_running_claim_is_committed_before_model_io(client, article_payload) -> None:
    observed_states: list[str] = []
    observed_budgets: list[dict[str, object]] = []

    def observe_persisted_run() -> None:
        with client.app.state.container.database.session() as session:
            runs = session.scalars(select(WorkflowRunORM)).all()
            observed_states.extend(run.status for run in runs)
            observed_budgets.extend(run.state_json["budget"] for run in runs)

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
            "policy": {"max_model_calls": 1},
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "completed"
    assert provider.calls == 1
    assert observed_states == ["running"]
    assert all(budget["model_calls_reserved"] == 1 for budget in observed_budgets)
    assert all(budget["model_calls_used"] == 0 for budget in observed_budgets)


@pytest.mark.skipif(preset_module.StateGraph is None, reason="LangGraph extra is unavailable")
def test_langgraph_fanout_respects_max_parallel(client, article_payload) -> None:
    provider = ConcurrencyTextProvider()
    client.app.state.container.model_access.text_provider = provider
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {
                "disabled_optional_node_ids": [],
                "max_model_calls": 7,
                "max_parallel": 2,
            },
        },
    )

    assert response.status_code == 201, response.text
    run = response.json()
    assert run["status"] == "completed"
    assert run["state_json"]["engine"] == "langgraph"
    assert run["state_json"]["budget"]["max_parallel"] == 2
    assert provider.max_active == 2


def test_wall_clock_budget_fails_after_preserving_consumed_call_claim(
    client,
    article_payload,
    monkeypatch,
) -> None:
    ticks = iter([100.0, 102.0])
    monkeypatch.setattr(harness_module, "monotonic", lambda: next(ticks))
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {
                "max_model_calls": 1,
                "max_wall_clock_seconds": 1,
            },
        },
    )

    assert response.status_code == 201, response.text
    run = response.json()
    assert run["status"] == "failed"
    assert run["output_revision_id"] is None
    assert "wall-clock budget" in run["error"]
    assert run["state_json"]["budget"]["model_calls_reserved"] == 1
    assert run["state_json"]["budget"]["model_calls_used"] == 1


def test_preset_definition_matches_required_chain_and_fanout(client) -> None:
    current = client.get("/api/v1/workflows").json()[0]
    assert current["version"] == "1.3.0"
    workflow = current["definition_json"]
    nodes = {node["id"]: node for node in workflow["nodes"]}
    assert workflow["required_model_calls"] == 6
    assert nodes["draft"]["default_enabled"] is True
    assert nodes["draft"]["required"] is True
    assert nodes["draft"]["skippable"] is False
    assert nodes["risk"]["default_enabled"] is True
    assert nodes["risk"]["type"] == "rule_check"
    assert nodes["reference-safety"] == {
        "id": "reference-safety",
        "type": "rule_check",
        "mode": "conditional_model_rewrite",
        "required": True,
        "skippable": False,
        "default_enabled": True,
    }
    for node_id in ("research", "outline", "natural-style", "review", "visual"):
        assert nodes[node_id]["default_enabled"] is False
        assert nodes[node_id]["required"] is False
        assert nodes[node_id]["skippable"] is True
    assert nodes["review"]["mode"] == "read_only"
    assert nodes["risk"]["mode"] == "read_only"
    assert nodes["visual"]["mode"] == "read_only"
    assert ["natural-style", "reference-safety"] in workflow["edges"]
    assert ["reference-safety", "review"] in workflow["edges"]
    assert ["reference-safety", "risk"] in workflow["edges"]
    assert ["reference-safety", "visual"] in workflow["edges"]
    assert workflow["joins"] == [
        {
            "target": "approval",
            "strategy": "all_enabled",
            "branches": ["review", "risk", "visual"],
        }
    ]


def test_demo_uses_current_preset_when_a_legacy_definition_exists(client) -> None:
    with client.app.state.container.database.session() as session:
        SqlAlchemyRuntimeRepository(session).add_workflow(
            Workflow(
                name="mock-article",
                version="1.0.0",
                definition_json={"schema_version": "workflow.v1", "nodes": []},
                definition_hash="0" * 64,
            )
        )

    workflows = client.get("/api/v1/workflows").json()
    assert [workflow["version"] for workflow in workflows[:2]] == ["1.3.0", "1.0.0"]
    response = client.post(
        "/api/v1/demo/complete",
        json={"platforms": ["csdn"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["run"]["workflow_snapshot_json"]["version"] == "1.3.0"


def test_workflow_has_deterministic_sequential_fallback(
    client, article_payload, monkeypatch
) -> None:
    monkeypatch.setattr(preset_module, "StateGraph", None)
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
    assert response.status_code == 201, response.text
    run = response.json()
    assert run["status"] == "completed"
    assert run["state_json"]["engine"] == "sequential-customized"
    assert run["state_json"]["raw_draft_artifact_id"]
    assert run["state_json"]["risk_artifact_id"]


def test_api_customized_run_skips_optional_nodes_and_uses_dynamic_budget(
    client, article_payload
) -> None:
    provider = CountingTextProvider()
    client.app.state.container.model_access.text_provider = provider
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]
    disabled = ["research", "outline", "natural-style", "review", "visual"]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {
                "disabled_optional_node_ids": disabled,
                "max_model_calls": 1,
            },
        },
    )

    assert response.status_code == 201, response.text
    run = response.json()
    assert run["status"] == "completed"
    assert provider.calls == 1
    assert provider.purposes == ["draft"]
    assert run["state_json"]["engine"] in {
        "langgraph-customized",
        "sequential-customized",
    }
    assert run["state_json"]["enabled_node_ids"] == ["draft"]
    assert run["state_json"]["disabled_optional_node_ids"] == disabled
    assert run["state_json"]["required_model_calls"] == 1
    assert run["state_json"]["budget"] == {
        "model_calls_limit": 1,
        "model_calls_reserved": 1,
        "model_calls_used": 1,
        "max_parallel": 4,
        "max_wall_clock_seconds": 300,
    }
    assert run["state_json"]["pending_draft_artifact_id"] == run["state_json"][
        "raw_draft_artifact_id"
    ]
    for state_key in (
        "research_artifact_id",
        "outline_artifact_id",
        "natural_style_patch_artifact_id",
        "canonical_draft_artifact_id",
        "review_artifact_id",
        "visual_plan_artifact_id",
    ):
        assert state_key not in run["state_json"]
    assert run["state_json"]["risk_artifact_id"]

    selection = run["workflow_snapshot_json"]["node_selection"]
    assert selection == {
        "enabled_node_ids": ["draft"],
        "disabled_optional_node_ids": disabled,
        "required_model_calls": 1,
        "reference_safety_reservation": 0,
    }
    assert run["workflow_snapshot_json"]["policy"][
        "disabled_optional_node_ids"
    ] == disabled

    detail = client.get(f"/api/v1/runs/{run['id']}").json()
    skipped_events = [
        event
        for event in detail["events"]
        if event["event_type"] == "run.node_skipped"
    ]
    assert [event["payload_json"]["node_id"] for event in skipped_events] == disabled
    assert {
        event["payload_json"]["reason"] for event in skipped_events
    } == {"disabled_by_run_policy"}
    assert detail["events"][0]["event_type"] == "run.queued"
    assert detail["events"][1]["event_type"] == "run.started"
    assert detail["events"][-1]["event_type"] == "run.completed"

    with client.app.state.container.database.session() as session:
        run_artifacts = [
            artifact
            for artifact in session.scalars(select(ArtifactORM)).all()
            if artifact.metadata_json.get("run_id") == run["id"]
        ]
        assert {artifact.kind for artifact in run_artifacts} == {
            "workflow.raw-draft",
            "workflow.risk-report",
        }

    article_detail = client.get(
        f"/api/v1/articles/{article['article']['id']}"
    ).json()
    with client.app.state.container.database.session() as session:
        artifacts = ArtifactService(
            SqlAlchemyRuntimeRepository(session),
            client.app.state.container.blob_store,
        )
        raw_draft = artifacts.read_text(run["state_json"]["raw_draft_artifact_id"])
    assert article_detail["latest_revision"]["markdown"] == raw_draft


def test_writer_uses_long_form_output_budget(client, article_payload) -> None:
    provider = RecordingTextProvider()
    client.app.state.container.model_access.text_provider = provider
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {
                "disabled_optional_node_ids": [
                    "research",
                    "outline",
                    "natural-style",
                    "review",
                    "visual",
                ],
                "max_model_calls": 1,
            },
        },
    )

    assert response.status_code == 201, response.text
    assert len(provider.requests) == 1
    assert provider.requests[0].purpose == "draft"
    assert provider.requests[0].max_output_tokens == 8_192


def test_customized_budget_still_rejects_less_than_enabled_call_count(
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
            "policy": {
                "disabled_optional_node_ids": [
                    "research",
                    "outline",
                    "natural-style",
                    "review",
                ],
                "max_model_calls": 1,
            },
        },
    )

    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "failed"
    assert "model-call budget" in run["error"]
    assert "(1 < 3)" in run["error"]
    assert provider.calls == 0
    assert run["workflow_snapshot_json"]["node_selection"]["required_model_calls"] == 3
    assert run["state_json"]["budget"]["model_calls_reserved"] == 0


@pytest.mark.parametrize(
    ("policy", "expected_status"),
    [
        ({"max_parallel": 0}, 422),
        ({"max_parallel": 9}, 422),
        ({"max_wall_clock_seconds": 0}, 422),
        ({"max_wall_clock_seconds": 3601}, 422),
    ],
)
def test_run_policy_rejects_invalid_harness_limits(
    client,
    article_payload,
    policy,
    expected_status,
) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]
    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": policy,
        },
    )
    assert response.status_code == expected_status


@pytest.mark.parametrize(
    "disabled_node_ids",
    [
        ["draft"],
        ["risk"],
        ["research", "research"],
    ],
)
def test_run_policy_rejects_required_or_duplicate_disabled_nodes_at_api_boundary(
    client,
    article_payload,
    disabled_node_ids,
) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    workflow = client.get("/api/v1/workflows").json()[0]

    response = client.post(
        "/api/v1/runs",
        json={
            "workflow_id": workflow["id"],
            "article_id": article["article"]["id"],
            "revision_id": article["revision"]["id"],
            "policy": {"disabled_optional_node_ids": disabled_node_ids},
        },
    )

    assert response.status_code == 422


def test_content_approval_policy_still_controls_customized_run(
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
            "policy": {
                "disabled_optional_node_ids": [
                    "research",
                    "outline",
                    "natural-style",
                    "review",
                    "visual",
                ],
                "max_model_calls": 1,
                "require_content_approval": True,
            },
        },
    )

    assert response.status_code == 201, response.text
    waiting = response.json()
    assert waiting["status"] == "waiting_approval"
    assert waiting["approval_status"] == "pending"
    assert waiting["interrupt_json"]["draft_artifact_id"] == waiting["state_json"][
        "raw_draft_artifact_id"
    ]
    assert waiting["interrupt_json"]["risk_artifact_id"]
    assert "review_artifact_id" not in waiting["interrupt_json"]
    assert "visual_plan_artifact_id" not in waiting["interrupt_json"]
    assert provider.calls == 1

    resumed = client.post(
        f"/api/v1/runs/{waiting['id']}/resume",
        json={"action": "approve"},
    )
    assert resumed.status_code == 200, resumed.text
    assert resumed.json()["status"] == "completed"
    assert provider.calls == 1
