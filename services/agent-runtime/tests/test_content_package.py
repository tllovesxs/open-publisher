import base64
import hashlib

import pytest

import open_publisher_runtime.application.content_packages as package_module
import open_publisher_runtime.infrastructure.providers as provider_module


def _package(*, assets):
    markdown = "安全的 Markdown"
    return {
        "schema_version": "content-package.v1",
        "source_app": "test-suite",
        "article": {
            "title": "导入测试",
            "revision_number": 1,
            "canonical_markdown": markdown,
            "content_hash": hashlib.sha256(markdown.encode()).hexdigest(),
        },
        "assets": assets,
    }


def _asset(path: str, data: bytes = b"asset", *, content_hash: str | None = None):
    return {
        "path": path,
        "kind": "image",
        "media_type": "image/png",
        "content_base64": base64.b64encode(data).decode(),
        "content_hash": content_hash or hashlib.sha256(data).hexdigest(),
    }


def test_content_package_v1_round_trip(client, article_payload) -> None:
    created = client.post("/api/v1/articles", json=article_payload).json()
    exported = client.post(
        "/api/v1/content-packages/export",
        json={
            "article_id": created["article"]["id"],
            "artifact_ids": [created["revision"]["artifact_id"]],
        },
    )
    assert exported.status_code == 200, exported.text
    package = exported.json()
    assert package["schema_version"] == "content-package.v1"
    assert package["assets"][0]["path"].endswith(".md")
    assert package["assets"][0]["metadata"]["artifact_id"] == created["revision"]["artifact_id"]

    imported = client.post("/api/v1/content-packages/import", json=package)
    assert imported.status_code == 201, imported.text
    payload = imported.json()
    assert payload["article"]["id"] != created["article"]["id"]
    assert payload["revision"]["content_hash"] == created["revision"]["content_hash"]


def test_complete_demo_closes_the_local_loop_without_network(client, monkeypatch) -> None:
    def reject_network(*args, **kwargs):
        raise AssertionError("deterministic demo attempted a network request")

    monkeypatch.setattr(provider_module.httpx, "post", reject_network)
    response = client.post(
        "/api/v1/demo/complete",
        json={
            "title": "完整闭环",
            "topic": "本地演示",
            "source_markdown": "一段演示素材。",
            "platforms": ["csdn", "wechat", "toutiao"],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run"]["status"] == "completed"
    assert payload["plan"]["status"] == "completed"
    assert len(payload["receipts"]) == 3
    assert all(receipt["status"] == "dry_run_succeeded" for receipt in payload["receipts"])
    assert {asset["kind"] for asset in payload["content_package"]["assets"]} == {
        "workflow.research",
        "workflow.outline",
        "workflow.raw-draft",
        "workflow.natural-style-patch",
        "workflow.canonical-draft",
        "workflow.review-report",
        "workflow.risk-report",
        "workflow.visual-plan",
        "workflow.visual-outline",
        "workflow.visual-material-selection",
        "workflow.visual-prompts",
        "workflow.writer-prompt",
        "workflow.source-ledger",
        "workflow.fact-ledger",
        "platform-variant.csdn",
        "platform-variant.wechat",
        "platform-variant.toutiao",
    }
    assert set(payload["content_package"]["metadata"]["platform_variant_ids"]) == {
        variant["id"] for variant in payload["variants"]
    }


def test_complete_demo_honors_optional_node_selection(client) -> None:
    response = client.post(
        "/api/v1/demo/complete",
        json={
            "title": "精简闭环",
            "topic": "显式跳过可选节点",
            "source_markdown": "只保留正文和必经风险审核。",
            "platforms": ["wechat"],
            "disabled_optional_node_ids": [
                "research",
                "outline",
                "natural-style",
                "review",
                "visual",
            ],
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["run"]["state_json"]["engine"] in {
        "langgraph-customized",
        "sequential-customized",
    }
    assert payload["run"]["state_json"]["disabled_optional_node_ids"] == [
        "research",
        "outline",
        "natural-style",
        "review",
        "visual",
    ]
    assert {asset["kind"] for asset in payload["content_package"]["assets"]} == {
        "workflow.raw-draft",
        "workflow.risk-report",
        "workflow.writer-prompt",
        "workflow.source-ledger",
        "workflow.fact-ledger",
        "platform-variant.wechat",
    }


@pytest.mark.parametrize(
    "unsafe_path",
    [
        "",
        ".",
        "..",
        "/absolute/path",
        "C:/Windows/win.ini",
        r"assets\cover.png",
        "assets//cover.png",
        "assets/./cover.png",
        "assets/../cover.png",
        "assets/%2e%2e/cover.png",
    ],
)
def test_content_package_rejects_unsafe_asset_paths(client, unsafe_path) -> None:
    response = client.post(
        "/api/v1/content-packages/import",
        json=_package(assets=[_asset(unsafe_path)]),
    )
    assert response.status_code == 422


def test_content_package_rejects_duplicate_paths_and_excess_asset_count(client) -> None:
    duplicates = client.post(
        "/api/v1/content-packages/import",
        json=_package(assets=[_asset("assets/same.png"), _asset("assets/same.png")]),
    )
    assert duplicates.status_code == 422

    too_many = client.post(
        "/api/v1/content-packages/import",
        json=_package(assets=[_asset(f"assets/{index}.png") for index in range(65)]),
    )
    assert too_many.status_code == 422


def test_content_package_validates_all_hashes_before_writing_any_blob(client) -> None:
    artifact_root = client.app.state.container.blob_store.root
    response = client.post(
        "/api/v1/content-packages/import",
        json=_package(
            assets=[
                _asset("assets/valid.png", b"valid"),
                _asset("assets/tampered.png", b"tampered", content_hash="0" * 64),
            ]
        ),
    )
    assert response.status_code == 409
    assert not any(path.is_file() for path in artifact_root.rglob("*"))


def test_content_package_enforces_single_and_total_decoded_size_before_writes(
    client, monkeypatch
) -> None:
    artifact_root = client.app.state.container.blob_store.root
    monkeypatch.setattr(package_module, "MAX_CONTENT_PACKAGE_ASSET_BYTES", 3)
    oversized = client.post(
        "/api/v1/content-packages/import",
        json=_package(assets=[_asset("assets/oversized.bin", b"1234")]),
    )
    assert oversized.status_code == 409
    assert not any(path.is_file() for path in artifact_root.rglob("*"))

    monkeypatch.setattr(package_module, "MAX_CONTENT_PACKAGE_ASSET_BYTES", 10)
    monkeypatch.setattr(package_module, "MAX_CONTENT_PACKAGE_TOTAL_ASSET_BYTES", 5)
    over_total = client.post(
        "/api/v1/content-packages/import",
        json=_package(
            assets=[
                _asset("assets/first.bin", b"123"),
                _asset("assets/second.bin", b"456"),
            ]
        ),
    )
    assert over_total.status_code == 409
    assert not any(path.is_file() for path in artifact_root.rglob("*"))
