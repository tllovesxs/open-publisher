from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator, FormatChecker

from open_publisher_runtime.api.schemas import (
    ApprovePublishPlanRequest,
    CreateArticleRequest,
    CreateConnectionProfileRequest,
    CreatePublishPlanRequest,
    CreateRevisionRequest,
    CreateRunRequest,
    DemoRequest,
    GenerateImagesRequest,
    RewriteArticleRequest,
)

ROOT = Path(__file__).resolve().parents[3]
SCHEMA = json.loads(
    (ROOT / "packages/contracts/schemas/v1/sidecar-protocol.schema.json").read_text(
        encoding="utf-8"
    )
)
FIXTURES = json.loads(
    (ROOT / "packages/contracts/fixtures/v1/sidecar-protocol.json").read_text(encoding="utf-8")
)


def validate_definition(definition: str, payload: Any) -> None:
    wrapper = {
        "$schema": SCHEMA["$schema"],
        "$defs": SCHEMA["$defs"],
        "$ref": f"#/$defs/{definition}",
    }
    Draft202012Validator(wrapper, format_checker=FormatChecker()).validate(payload)


def test_canonical_requests_match_pydantic_models() -> None:
    models = {
        "CreateArticleRequest": CreateArticleRequest,
        "CreateRevisionRequest": CreateRevisionRequest,
        "CompleteDemoRequest": DemoRequest,
        "GenerateImagesRequest": GenerateImagesRequest,
        "RewriteArticleRequest": RewriteArticleRequest,
        "CreateConnectionProfileRequest": CreateConnectionProfileRequest,
        "StartRunRequest": CreateRunRequest,
        "CreatePublishPlanRequest": CreatePublishPlanRequest,
        "ApprovePublishPlanRequest": ApprovePublishPlanRequest,
    }
    for definition, model_type in models.items():
        payload = FIXTURES[definition]
        parsed = model_type.model_validate(payload)
        assert parsed.model_dump(mode="json", exclude_unset=True) == payload
        validate_definition(definition, payload)


def test_live_sidecar_responses_match_canonical_rust_projections(client) -> None:
    health = client.get("/health")
    assert health.status_code == 200
    validate_definition("HealthResponse", health.json())

    article = client.post("/api/v1/articles", json=FIXTURES["CreateArticleRequest"])
    assert article.status_code == 201, article.text
    article_payload = article.json()
    validate_definition("CreateArticleResponse", article_payload)

    articles = client.get("/api/v1/articles")
    assert articles.status_code == 200
    validate_definition("ListArticlesResponse", articles.json())

    article_detail = client.get(f"/api/v1/articles/{article_payload['article']['id']}")
    assert article_detail.status_code == 200
    validate_definition("ArticleDetailResponse", article_detail.json())

    revision_request = {
        **FIXTURES["CreateRevisionRequest"],
        "parent_revision_id": article_payload["revision"]["id"],
    }
    revision = client.post(
        f"/api/v1/articles/{article_payload['article']['id']}/revisions",
        json=revision_request,
    )
    assert revision.status_code == 201, revision.text
    validate_definition("CreateRevisionResponse", revision.json())

    workflows = client.get("/api/v1/workflows")
    assert workflows.status_code == 200
    workflow_payload = workflows.json()
    validate_definition("ListWorkflowsResponse", workflow_payload)

    run_request = {
        **FIXTURES["StartRunRequest"],
        "workflow_id": workflow_payload[0]["id"],
        "article_id": article_payload["article"]["id"],
        "revision_id": revision.json()["id"],
    }
    CreateRunRequest.model_validate(run_request)
    validate_definition("StartRunRequest", run_request)
    run = client.post("/api/v1/runs", json=run_request)
    assert run.status_code == 201, run.text
    run_payload = run.json()
    validate_definition("WorkflowRunResponse", run_payload)

    output_article_detail = client.get(
        f"/api/v1/articles/{article_payload['article']['id']}"
    )
    assert output_article_detail.status_code == 200
    validate_definition("ArticleDetailResponse", output_article_detail.json())

    image = client.post("/api/v1/images/generate", json=FIXTURES["GenerateImagesRequest"])
    assert image.status_code == 201, image.text
    validate_definition("GenerateImagesResponse", image.json())

    rewrite = client.post("/api/v1/editor/rewrite", json=FIXTURES["RewriteArticleRequest"])
    assert rewrite.status_code == 200, rewrite.text
    validate_definition("RewriteArticleResponse", rewrite.json())

    connection = client.post(
        "/api/v1/connections",
        json=FIXTURES["CreateConnectionProfileRequest"],
    )
    assert connection.status_code == 201, connection.text
    connection_payload = connection.json()
    validate_definition("ConnectionProfilePublic", connection_payload)
    assert "secret_ref" not in connection_payload

    connections = client.get("/api/v1/connections")
    assert connections.status_code == 200
    validate_definition("ListConnectionProfilesResponse", connections.json())

    plan_request = {
        **FIXTURES["CreatePublishPlanRequest"],
        "revision_id": run_payload["output_revision_id"],
    }
    CreatePublishPlanRequest.model_validate(plan_request)
    validate_definition("CreatePublishPlanRequest", plan_request)
    plan = client.post("/api/v1/publish/plans", json=plan_request)
    assert plan.status_code == 201, plan.text
    plan_payload = plan.json()
    validate_definition("PublishPlanDetailResponse", plan_payload)
    plan_id = plan_payload["plan"]["id"]

    approval = client.post(
        f"/api/v1/publish/plans/{plan_id}/approve",
        json=FIXTURES["ApprovePublishPlanRequest"],
    )
    assert approval.status_code == 200, approval.text
    validate_definition("PublishPlanDetailResponse", approval.json())

    validate_definition("EmptyRequest", FIXTURES["EmptyRequest"])
    enqueued = client.post(
        f"/api/v1/publish/plans/{plan_id}/enqueue",
        json=FIXTURES["EmptyRequest"],
    )
    assert enqueued.status_code == 200, enqueued.text
    enqueue_payload = enqueued.json()
    validate_definition("EnqueuePublishPlanResponse", enqueue_payload)

    processed = client.post(
        f"/api/v1/publish/jobs/{enqueue_payload['jobs'][0]['id']}/process",
        json=FIXTURES["EmptyRequest"],
    )
    assert processed.status_code == 200, processed.text
    validate_definition("ProcessPublishJobResponse", processed.json())

    refreshed_plan = client.get(f"/api/v1/publish/plans/{plan_id}")
    assert refreshed_plan.status_code == 200
    validate_definition("PublishPlanDetailResponse", refreshed_plan.json())

    demo = client.post("/api/v1/demo/complete", json=FIXTURES["CompleteDemoRequest"])
    assert demo.status_code == 200, demo.text
    validate_definition("CompleteDemoResponse", demo.json())
