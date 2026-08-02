def test_health_and_version(client) -> None:
    health = client.get("/health")
    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "database": "ok",
        "publisher_mode": "dry_run_and_wechat_sync_draft",
    }

    version = client.get("/api/v1/version")
    assert version.status_code == 200
    payload = version.json()
    assert payload["api_version"] == "v1"
    assert payload["remote_publish_enabled"] is False
