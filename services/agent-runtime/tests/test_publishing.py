from open_publisher_runtime.application.publishing import DryRunResult
from open_publisher_runtime.infrastructure.orm import ArtifactORM, PlatformVariantORM
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository


class RecordingPublisher:
    def __init__(self) -> None:
        self.publish_calls = 0
        self.reconcile_calls = 0

    def publish(self, job, variant):
        self.publish_calls += 1
        return DryRunResult(
            remote_id=f"recorded-{job.id}",
            remote_url=None,
            details={"mode": "dry_run"},
        )

    def reconcile(self, job, variant):
        self.reconcile_calls += 1
        return DryRunResult(
            remote_id=f"reconciled-{job.id}",
            remote_url=None,
            details={"mode": "dry_run_reconcile"},
        )


def _create_plan(client, article_payload):
    article = client.post("/api/v1/articles", json=article_payload).json()
    plan_response = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "targets": [
                {
                    "platform": "csdn",
                    "account_ref": "demo-csdn",
                }
            ],
        },
    )
    assert plan_response.status_code == 201, plan_response.text
    plan = plan_response.json()
    approval = client.post(
        f"/api/v1/publish/plans/{plan['plan']['id']}/approve",
        json={"actor_id": "user:test"},
    )
    assert approval.status_code == 200, approval.text
    return approval.json()


def test_publish_outbox_is_idempotent_and_never_remote(client, article_payload) -> None:
    plan = _create_plan(client, article_payload)
    plan_id = plan["plan"]["id"]

    first_enqueue = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue")
    second_enqueue = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue")
    assert first_enqueue.status_code == 200, first_enqueue.text
    assert second_enqueue.status_code == 200, second_enqueue.text
    first_job = first_enqueue.json()["jobs"][0]
    second_job = second_enqueue.json()["jobs"][0]
    assert first_job["id"] == second_job["id"]
    assert first_job["idempotency_key"] == second_job["idempotency_key"]

    processed = client.post(f"/api/v1/publish/jobs/{first_job['id']}/process")
    assert processed.status_code == 200, processed.text
    payload = processed.json()
    assert payload["job"]["state"] == "succeeded"
    assert payload["receipt"]["status"] == "dry_run_succeeded"
    assert payload["receipt"]["remote_url"] is None
    assert payload["receipt"]["details_json"]["notice"] == "No remote API was called."

    repeated = client.post(f"/api/v1/publish/jobs/{first_job['id']}/process")
    assert repeated.status_code == 200
    assert repeated.json()["receipt"]["id"] == payload["receipt"]["id"]


def test_unknown_job_requires_reconciliation(client, article_payload) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    plan = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "targets": [
                {
                    "platform": "wechat",
                    "account_ref": "demo-wechat",
                    "simulate_outcome": "unknown_then_success",
                }
            ],
        },
    ).json()
    approval = client.post(
        f"/api/v1/publish/plans/{plan['plan']['id']}/approve",
        json={"actor_id": "user:test"},
    )
    assert approval.status_code == 200, approval.text
    job = client.post(f"/api/v1/publish/plans/{plan['plan']['id']}/enqueue").json()["jobs"][0]
    unknown = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert unknown.status_code == 200
    assert unknown.json()["job"]["state"] == "unknown"
    assert unknown.json()["receipt"] is None

    reconciled = client.post(f"/api/v1/publish/jobs/{job['id']}/reconcile")
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["job"]["state"] == "succeeded"
    assert reconciled.json()["receipt"]["details_json"]["mode"] == "dry_run_reconcile"


def test_publish_plan_requires_explicit_hash_bound_approval(client, article_payload) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    created = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "targets": [{"platform": "csdn", "account_ref": "approval-test"}],
        },
    )
    assert created.status_code == 201
    plan = created.json()["plan"]
    assert plan["status"] == "draft"
    assert plan["approval_status"] == "pending"
    assert "approval_grant" not in plan["plan_json"]

    blocked = client.post(f"/api/v1/publish/plans/{plan['id']}/enqueue")
    assert blocked.status_code == 409

    approved = client.post(
        f"/api/v1/publish/plans/{plan['id']}/approve",
        json={"actor_id": "user:approval-test", "comment": "preview confirmed"},
    )
    assert approved.status_code == 200, approved.text
    grant = approved.json()["plan"]["plan_json"]["approval_grant"]
    assert grant["actor_id"] == "user:approval-test"
    assert grant["revision_hash"] == article["revision"]["content_hash"]
    assert grant["requested_operation"] == "dry_run"
    assert grant["risk_policy_version"] == "p0-dry-run-risk.v1"
    assert grant["selected_asset_hashes"] == []
    assert len(grant["binding_hash"]) == 64
    assert grant["target_hashes"]

    approved_variant = approved.json()["variants"][0]
    assert (
        approved_variant["metadata_json"]["producer"]
        == "deterministic-platform-transform.v1"
    )
    variant_id = approved_variant["id"]
    with client.app.state.container.database.session() as session:
        variant = session.get(PlatformVariantORM, variant_id)
        assert variant is not None
        variant.title = "审批后被篡改的标题"
    tampered = client.post(f"/api/v1/publish/plans/{plan['id']}/enqueue")
    assert tampered.status_code == 409
    assert "changed after approval" in tampered.text


def test_publish_plan_resolves_and_binds_selected_asset_ids(
    client,
    article_payload,
) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    image_response = client.post(
        "/api/v1/images/generate",
        json={"prompt": "selected cover", "size": "512x512"},
    )
    assert image_response.status_code == 201, image_response.text
    image = image_response.json()["artifacts"][0]

    created = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "selected_asset_ids": [image["id"]],
            "targets": [{"platform": "wechat", "account_ref": "asset-binding"}],
        },
    )
    assert created.status_code == 201, created.text
    plan = created.json()["plan"]
    assert plan["plan_json"]["selected_asset_ids"] == [image["id"]]
    assert plan["plan_json"]["selected_asset_hashes"] == [image["content_hash"]]

    approved = client.post(
        f"/api/v1/publish/plans/{plan['id']}/approve",
        json={"actor_id": "user:asset-binding"},
    )
    assert approved.status_code == 200, approved.text
    grant = approved.json()["plan"]["plan_json"]["approval_grant"]
    assert grant["selected_asset_hashes"] == [image["content_hash"]]

    duplicate = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "selected_asset_ids": [image["id"], image["id"]],
            "targets": [{"platform": "wechat", "account_ref": "asset-binding"}],
        },
    )
    assert duplicate.status_code == 422


def test_selected_asset_mutation_blocks_job_before_publisher_io(
    client,
    article_payload,
) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    image = client.post(
        "/api/v1/images/generate",
        json={"prompt": "immutable cover", "size": "512x512"},
    ).json()["artifacts"][0]
    created = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "selected_asset_ids": [image["id"]],
            "targets": [{"platform": "wechat", "account_ref": "asset-tamper"}],
        },
    ).json()
    plan_id = created["plan"]["id"]
    client.post(
        f"/api/v1/publish/plans/{plan_id}/approve",
        json={"actor_id": "user:asset-tamper"},
    )
    job = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue").json()["jobs"][0]
    publisher = RecordingPublisher()
    client.app.state.container.dry_run_publisher = publisher

    with client.app.state.container.database.session() as session:
        artifact = session.get(ArtifactORM, image["id"])
        assert artifact is not None
        artifact.content_hash = "f" * 64

    response = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert response.status_code == 409, response.text
    assert "selected assets changed" in response.text
    assert publisher.publish_calls == 0


def test_completed_plan_cannot_regress_when_reenqueued(client, article_payload) -> None:
    plan = _create_plan(client, article_payload)
    plan_id = plan["plan"]["id"]
    job = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue").json()["jobs"][0]
    processed = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert processed.status_code == 200
    assert client.get(f"/api/v1/publish/plans/{plan_id}").json()["plan"]["status"] == "completed"

    repeated_enqueue = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue")
    assert repeated_enqueue.status_code == 200
    assert repeated_enqueue.json()["jobs"][0]["id"] == job["id"]
    assert client.get(f"/api/v1/publish/plans/{plan_id}").json()["plan"]["status"] == "completed"

    repeated_process = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert repeated_process.status_code == 200
    assert client.get(f"/api/v1/publish/plans/{plan_id}").json()["plan"]["status"] == "completed"


def test_publish_claim_and_attempt_are_committed_before_publisher_io(
    client, article_payload
) -> None:
    observed: dict[str, object] = {}
    database = client.app.state.container.database

    class InspectingPublisher:
        def publish(self, job, variant):
            with database.session() as session:
                repository = SqlAlchemyRuntimeRepository(session)
                persisted = repository.get_publish_job(job.id)
                attempts = repository.list_publish_attempts(job.id)
                observed["state"] = persisted.state if persisted else None
                observed["attempt_count"] = len(attempts)
                observed["idempotency_key"] = job.idempotency_key
            return DryRunResult(
                remote_id=f"inspected-{job.id}",
                remote_url=None,
                details={
                    "mode": "dry_run",
                    "idempotency_key": job.idempotency_key,
                },
            )

        def reconcile(self, job, variant):
            return None

    client.app.state.container.dry_run_publisher = InspectingPublisher()
    plan = _create_plan(client, article_payload)
    job = client.post(
        f"/api/v1/publish/plans/{plan['plan']['id']}/enqueue"
    ).json()["jobs"][0]
    response = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert response.status_code == 200, response.text
    assert response.json()["job"]["state"] == "succeeded"
    assert observed == {
        "state": "in_progress",
        "attempt_count": 1,
        "idempotency_key": job["idempotency_key"],
    }


def test_process_revalidates_approval_binding_before_publisher_io(
    client,
    article_payload,
) -> None:
    plan = _create_plan(client, article_payload)
    plan_id = plan["plan"]["id"]
    variant_id = plan["variants"][0]["id"]
    job = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue").json()["jobs"][0]
    publisher = RecordingPublisher()
    client.app.state.container.dry_run_publisher = publisher

    with client.app.state.container.database.session() as session:
        variant = session.get(PlatformVariantORM, variant_id)
        assert variant is not None
        variant.title = "入队后被篡改"

    response = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert response.status_code == 409, response.text
    assert "changed after approval" in response.text
    assert publisher.publish_calls == 0
    persisted = client.get(f"/api/v1/publish/plans/{plan_id}").json()["jobs"][0]
    assert persisted["state"] == "pending"


def test_reconcile_revalidates_approval_binding_before_adapter_io(
    client,
    article_payload,
) -> None:
    article = client.post("/api/v1/articles", json=article_payload).json()
    created = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "targets": [
                {
                    "platform": "wechat",
                    "account_ref": "reconcile-binding",
                    "simulate_outcome": "unknown_then_success",
                }
            ],
        },
    ).json()
    plan_id = created["plan"]["id"]
    variant_id = created["variants"][0]["id"]
    client.post(
        f"/api/v1/publish/plans/{plan_id}/approve",
        json={"actor_id": "user:reconcile-binding"},
    )
    job = client.post(f"/api/v1/publish/plans/{plan_id}/enqueue").json()["jobs"][0]
    unknown = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert unknown.json()["job"]["state"] == "unknown"

    publisher = RecordingPublisher()
    client.app.state.container.dry_run_publisher = publisher
    with client.app.state.container.database.session() as session:
        variant = session.get(PlatformVariantORM, variant_id)
        assert variant is not None
        variant.title = "对账前被篡改"

    response = client.post(f"/api/v1/publish/jobs/{job['id']}/reconcile")
    assert response.status_code == 409, response.text
    assert "changed after approval" in response.text
    assert publisher.reconcile_calls == 0
    persisted = client.get(f"/api/v1/publish/plans/{plan_id}").json()["jobs"][0]
    assert persisted["state"] == "unknown"
