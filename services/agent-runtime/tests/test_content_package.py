def test_content_package_v1_round_trip(client, article_payload) -> None:
    created = client.post("/api/v1/articles", json=article_payload).json()
    exported = client.post(
        "/api/v1/content-packages/export",
        json={"article_id": created["article"]["id"]},
    )
    assert exported.status_code == 200, exported.text
    package = exported.json()
    assert package["schema_version"] == "content-package.v1"

    imported = client.post("/api/v1/content-packages/import", json=package)
    assert imported.status_code == 201, imported.text
    payload = imported.json()
    assert payload["article"]["id"] != created["article"]["id"]
    assert payload["revision"]["content_hash"] == created["revision"]["content_hash"]


def test_complete_demo_closes_the_local_loop(client) -> None:
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

