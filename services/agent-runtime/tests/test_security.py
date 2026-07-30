from open_publisher_runtime.config import Settings


def test_sidecar_api_requires_matching_bearer_token(client) -> None:
    original = client.headers.pop("Authorization")
    try:
        missing = client.get("/health")
        assert missing.status_code == 401

        wrong = client.get(
            "/health",
            headers={"Authorization": "Bearer wrong-token-that-is-not-authorized"},
        )
        assert wrong.status_code == 401
        assert wrong.headers["www-authenticate"] == "Bearer"
    finally:
        client.headers["Authorization"] = original


def test_runtime_rejects_non_loopback_hosts(tmp_path) -> None:
    try:
        Settings(
            data_dir=tmp_path,
            api_host="0.0.0.0",
            api_token="test-open-publisher-sidecar-token-0001",
        )
    except ValueError as error:
        assert "loopback" in str(error)
    else:
        raise AssertionError("non-loopback sidecar host was accepted")


def test_connection_profile_rejects_nested_secrets_and_returns_public_dto(client) -> None:
    leaked = client.post(
        "/api/v1/connections",
        json={
            "name": "unsafe",
            "provider": "openai-compatible",
            "secret_ref": "env://OPENAI_API_KEY",
            "config": {
                "headers": {"Authorization": "Bearer plaintext-secret"},
                "client_secret": "plaintext-secret",
            },
        },
    )
    assert leaked.status_code == 409

    embedded_url_secret = client.post(
        "/api/v1/connections",
        json={
            "name": "unsafe-url",
            "provider": "openai-compatible",
            "secret_ref": "env://OPENAI_API_KEY",
            "base_url": "https://user:password@example.com/v1",
            "config": {},
        },
    )
    assert embedded_url_secret.status_code == 409

    sensitive_query = client.post(
        "/api/v1/connections",
        json={
            "name": "unsafe-query",
            "provider": "openai-compatible",
            "secret_ref": "env://OPENAI_API_KEY",
            "base_url": "https://example.com/v1?api_key=plaintext",
            "config": {},
        },
    )
    assert sensitive_query.status_code == 409

    neutral_key_secret = client.post(
        "/api/v1/connections",
        json={
            "name": "unsafe-neutral-key",
            "provider": "openai-compatible",
            "secret_ref": "env://OPENAI_API_KEY",
            "config": {
                "options": [
                    {"value": "sk-this-is-obviously-a-plaintext-secret-123456"}
                ]
            },
        },
    )
    assert neutral_key_secret.status_code == 409

    insecure_remote_url = client.post(
        "/api/v1/connections",
        json={
            "name": "unsafe-http",
            "provider": "openai-compatible",
            "secret_ref": "env://OPENAI_API_KEY",
            "base_url": "http://example.com/v1",
            "config": {},
        },
    )
    assert insecure_remote_url.status_code == 409

    created = client.post(
        "/api/v1/connections",
        json={
            "name": "safe",
            "provider": "openai-compatible",
            "secret_ref": "env://OPENAI_API_KEY",
            "base_url": "https://example.com/v1",
            "config": {"default_model": "example-model", "timeout_seconds": 30},
        },
    )
    assert created.status_code == 201, created.text
    payload = created.json()
    assert payload["secret_scheme"] == "env"
    assert payload["secret_configured"] is True
    assert "secret_ref" not in payload

    listed = client.get("/api/v1/connections").json()
    assert len(listed) == 1
    assert listed[0]["id"] == payload["id"]
    assert listed[0]["config_json"] == payload["config_json"]
    assert listed[0]["secret_scheme"] == "env"
    assert "secret_ref" not in client.get("/api/v1/catalog").text
