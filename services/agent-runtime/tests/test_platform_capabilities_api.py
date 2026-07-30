from __future__ import annotations

from collections.abc import Iterator
from typing import Any


def _mapping_keys(value: object) -> Iterator[str]:
    if isinstance(value, dict):
        for key, nested in value.items():
            yield str(key)
            yield from _mapping_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _mapping_keys(nested)


def test_platform_capabilities_are_static_offline_and_do_not_select_fallback(client) -> None:
    response = client.get("/api/v1/platforms/capabilities")

    assert response.status_code == 200
    payload: dict[str, Any] = response.json()
    assert payload["evaluation"] == "static_offline"
    assert payload["network_probe_performed"] is False
    assert payload["remote_write_performed"] is False

    platforms = payload["platforms"]
    assert [summary["platform"] for summary in platforms] == [
        "wechat",
        "csdn",
        "toutiao",
    ]
    for summary in platforms:
        assert summary["fallback_selected"] is False
        assert [report["route"] for report in summary["reports"]] == [
            "official_api",
            "browser_extension",
            "manual_export",
        ]
        assert all(report["network_probe_performed"] is False for report in summary["reports"])
        assert all(report["remote_write_performed"] is False for report in summary["reports"])

    assert [summary["reports"][0]["state"] for summary in platforms] == [
        "needs_configuration",
        "unsupported",
        "unsupported",
    ]
    assert all(summary["reports"][1]["state"] == "needs_configuration" for summary in platforms)
    assert all(summary["reports"][2]["state"] == "available" for summary in platforms)
    assert not any(
        "secret" in key.casefold()
        or "token" in key.casefold()
        or "cookie" in key.casefold()
        for key in _mapping_keys(payload)
    )


def test_platform_capabilities_require_sidecar_bearer_token(client) -> None:
    authorization = client.headers.pop("Authorization")
    try:
        response = client.get("/api/v1/platforms/capabilities")
    finally:
        client.headers["Authorization"] = authorization

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
