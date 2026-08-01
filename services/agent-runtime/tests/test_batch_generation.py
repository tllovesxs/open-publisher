from __future__ import annotations

import time


def _wait_for_terminal_batch(client, batch_id: str) -> dict[str, object]:
    for _ in range(100):
        response = client.get(f"/api/v1/generation-batches/{batch_id}")
        assert response.status_code == 200, response.text
        payload = response.json()
        if payload["batch"]["status"] in {"completed", "needs_attention", "cancelled"}:
            return payload
        time.sleep(0.03)
    raise AssertionError("generation batch did not reach a terminal state")


def test_batch_topic_plan_and_persistent_parallel_generation(client) -> None:
    plan_response = client.post(
        "/api/v1/generation-batches/plan",
        json={
            "prompt": "拆解这个产品功能，每个主题一个功能，产生多篇文章",
            "count": 2,
        },
    )
    assert plan_response.status_code == 200, plan_response.text
    planned = plan_response.json()
    assert planned["planned_by"] == "model"
    assert len(planned["candidates"]) == 2

    batch_response = client.post(
        "/api/v1/generation-batches",
        json={
            "prompt": "批量产品文章",
            "candidates": planned["candidates"],
            "source_markdown": "# 作者资料\n\n只使用可验证的产品描述。",
            "policy": {"max_model_calls": 1},
            "writer_concurrency": 2,
        },
    )
    assert batch_response.status_code == 202, batch_response.text
    batch_id = batch_response.json()["batch"]["id"]
    terminal = _wait_for_terminal_batch(client, batch_id)

    assert terminal["batch"]["status"] == "completed"
    assert [item["status"] for item in terminal["items"]] == [
        "completed",
        "completed",
    ]
    assert all(item["article_id"] and item["run_id"] for item in terminal["items"])

    listing = client.get("/api/v1/generation-batches")
    assert listing.status_code == 200
    assert listing.json()[0]["batch"]["id"] == batch_id


def test_manual_batch_plan_never_spends_a_planning_model_call(client) -> None:
    response = client.post(
        "/api/v1/generation-batches/plan",
        json={
            "prompt": "ignored because manual topics are explicit",
            "manual_topics": ["功能 A 的上手指南", "功能 B 的边界说明"],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["planned_by"] == "manual"
    assert [candidate["topic"] for candidate in payload["candidates"]] == [
        "功能 A 的上手指南",
        "功能 B 的边界说明",
    ]
