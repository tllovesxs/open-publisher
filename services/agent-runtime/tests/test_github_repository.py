from __future__ import annotations

import base64

import httpx
import pytest

from open_publisher_runtime.application.github_repository import GitHubRepositoryTool


class JsonResponse:
    def __init__(self, payload: object, *, status_code: int = 200) -> None:
        self.payload = payload
        self.status_code = status_code
        self.content = b"{}"

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "GitHub test failure",
                request=httpx.Request("GET", "https://api.github.com"),
                response=httpx.Response(self.status_code),
            )

    def json(self) -> object:
        return self.payload


def test_github_repository_tool_reads_bounded_public_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    observed: list[tuple[str, dict[str, object]]] = []
    readme = base64.b64encode(b"# Wandao\n\nA local-first desktop tool.").decode()

    def get(url: str, **kwargs: object) -> JsonResponse:
        observed.append((url, kwargs))
        if url.endswith("/repos/example/wandao"):
            return JsonResponse(
                {
                    "description": "A focused desktop publishing tool.",
                    "language": "Rust",
                    "default_branch": "main",
                    "pushed_at": "2026-08-03T00:00:00Z",
                    "updated_at": "2026-08-03T00:00:00Z",
                    "topics": ["desktop", "writing"],
                }
            )
        if url.endswith("/repos/example/wandao/readme"):
            return JsonResponse({"encoding": "base64", "content": readme})
        if url.endswith("/repos/example/wandao/releases/latest"):
            return JsonResponse(
                {
                    "name": "v1.2.0",
                    "tag_name": "v1.2.0",
                    "published_at": "2026-08-02T00:00:00Z",
                    "body": "Reduced installer size.",
                }
            )
        if url.endswith("/repos/example/wandao/commits?per_page=5"):
            return JsonResponse(
                [
                    {
                        "sha": "a" * 40,
                        "commit": {
                            "message": "reduce package size",
                            "author": {"date": "2026-08-03T00:00:00Z"},
                        },
                    }
                ]
            )
        raise AssertionError(f"unexpected GitHub endpoint: {url}")

    monkeypatch.setattr(httpx, "get", get)
    sources = GitHubRepositoryTool(api_token="test-github-token").inspect(
        "https://github.com/example/wandao"
    )

    assert [source.source_id for source in sources] == [
        "github-repository",
        "github-readme",
        "github-release",
        "github-commits",
    ]
    assert "A focused desktop publishing tool." in sources[0].content
    assert "# Wandao" in sources[1].content
    assert "Reduced installer size." in sources[2].content
    assert "reduce package size" in sources[3].content
    assert all(kwargs["follow_redirects"] is False for _, kwargs in observed)
    assert all(
        kwargs["headers"]["Authorization"] == "Bearer test-github-token"
        for _, kwargs in observed
    )


def test_github_repository_tool_rejects_non_github_urls() -> None:
    with pytest.raises(ValueError, match="https://github.com"):
        GitHubRepositoryTool().inspect("https://example.com/owner/repository")
