def _create_plan(client, article_payload):
    article = client.post("/api/v1/articles", json=article_payload).json()
    plan_response = client.post(
        "/api/v1/publish/plans",
        json={
            "revision_id": article["revision"]["id"],
            "approved": True,
            "targets": [
                {
                    "platform": "csdn",
                    "account_ref": "demo-csdn",
                }
            ],
        },
    )
    assert plan_response.status_code == 201, plan_response.text
    return plan_response.json()


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
            "approved": True,
            "targets": [
                {
                    "platform": "wechat",
                    "account_ref": "demo-wechat",
                    "simulate_outcome": "unknown_then_success",
                }
            ],
        },
    ).json()
    job = client.post(f"/api/v1/publish/plans/{plan['plan']['id']}/enqueue").json()["jobs"][0]
    unknown = client.post(f"/api/v1/publish/jobs/{job['id']}/process")
    assert unknown.status_code == 200
    assert unknown.json()["job"]["state"] == "unknown"
    assert unknown.json()["receipt"] is None

    reconciled = client.post(f"/api/v1/publish/jobs/{job['id']}/reconcile")
    assert reconciled.status_code == 200, reconciled.text
    assert reconciled.json()["job"]["state"] == "succeeded"
    assert reconciled.json()["receipt"]["details_json"]["mode"] == "dry_run_reconcile"

