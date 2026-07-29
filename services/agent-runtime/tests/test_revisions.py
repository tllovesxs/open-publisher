def test_article_revisions_are_immutable_and_numbered(client, article_payload) -> None:
    created = client.post("/api/v1/articles", json=article_payload)
    assert created.status_code == 201, created.text
    created_payload = created.json()
    article_id = created_payload["article"]["id"]
    first = created_payload["revision"]
    assert first["number"] == 1

    second_response = client.post(
        f"/api/v1/articles/{article_id}/revisions",
        json={"markdown": "# 第二稿\n\n内容发生了变化。"},
    )
    assert second_response.status_code == 201, second_response.text
    second = second_response.json()
    assert second["number"] == 2
    assert second["parent_revision_id"] == first["id"]
    assert second["content_hash"] != first["content_hash"]

    detail = client.get(f"/api/v1/articles/{article_id}")
    assert detail.status_code == 200
    revisions = detail.json()["revisions"]
    assert [revision["number"] for revision in revisions] == [1, 2]
    assert revisions[0]["markdown"] == article_payload["markdown"]


def test_revision_parent_must_be_latest_revision_of_same_article(client) -> None:
    first_article = client.post(
        "/api/v1/articles",
        json={"title": "文章 A", "markdown": "A1"},
    ).json()
    second_article = client.post(
        "/api/v1/articles",
        json={"title": "文章 B", "markdown": "B1"},
    ).json()

    cross_article = client.post(
        f"/api/v1/articles/{first_article['article']['id']}/revisions",
        json={
            "markdown": "A2",
            "parent_revision_id": second_article["revision"]["id"],
        },
    )
    assert cross_article.status_code == 409

    second_revision = client.post(
        f"/api/v1/articles/{first_article['article']['id']}/revisions",
        json={
            "markdown": "A2",
            "parent_revision_id": first_article["revision"]["id"],
        },
    )
    assert second_revision.status_code == 201

    stale_parent = client.post(
        f"/api/v1/articles/{first_article['article']['id']}/revisions",
        json={
            "markdown": "A3",
            "parent_revision_id": first_article["revision"]["id"],
        },
    )
    assert stale_parent.status_code == 409
