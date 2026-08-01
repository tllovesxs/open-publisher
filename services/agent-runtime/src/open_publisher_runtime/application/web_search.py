from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

import httpx
from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class SourceEvidence(BaseModel):
    """A bounded, citeable web result retained with a workflow run."""

    model_config = ConfigDict(extra="forbid")

    source_id: str
    title: str = Field(min_length=1, max_length=500)
    url: HttpUrl
    content: str = Field(min_length=1, max_length=6_000)
    published_date: str | None = Field(default=None, max_length=80)
    score: float | None = None

    def prompt_card(self) -> dict[str, object]:
        return {
            "id": self.source_id,
            "title": self.title,
            "url": str(self.url),
            "published_date": self.published_date,
            "excerpt": self.content,
        }


@dataclass(frozen=True, slots=True)
class TavilySearchTool:
    """A narrow MCP-shaped search tool backed by Tavily's HTTPS API."""

    api_key: str
    timeout_seconds: float = 20.0
    max_results: int = 5

    name: str = "web_search"
    description: str = (
        "Search the public web for current or verifiable facts. Use only when the "
        "article needs sources beyond the author's provided material."
    )

    def definition(self) -> dict[str, object]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "A focused Chinese or English web query.",
                        },
                        "max_results": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": self.max_results,
                            "description": "Maximum source cards to return.",
                        },
                    },
                    "required": ["query"],
                    "additionalProperties": False,
                },
            },
        }

    def search(self, query: str, *, max_results: int | None = None) -> list[SourceEvidence]:
        normalized_query = " ".join(query.split())
        if not 2 <= len(normalized_query) <= 500:
            raise ValueError("web search query must contain between 2 and 500 characters")
        requested = max_results if max_results is not None else self.max_results
        if not isinstance(requested, int) or not 1 <= requested <= self.max_results:
            raise ValueError(f"web search max_results must be between 1 and {self.max_results}")

        response = httpx.post(
            "https://api.tavily.com/search",
            json={
                "api_key": self.api_key,
                "query": normalized_query,
                "search_depth": "basic",
                "max_results": requested,
                "include_answer": False,
                "include_raw_content": False,
            },
            timeout=self.timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        raw_results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(raw_results, Sequence):
            raise RuntimeError("Tavily returned an invalid search response")

        sources: list[SourceEvidence] = []
        seen_urls: set[str] = set()
        for raw in raw_results:
            if not isinstance(raw, dict):
                continue
            title = raw.get("title")
            url = raw.get("url")
            content = raw.get("content")
            if not all(isinstance(value, str) for value in (title, url, content)):
                continue
            normalized_url = url.strip()
            if not normalized_url or normalized_url in seen_urls or not content.strip():
                continue
            seen_urls.add(normalized_url)
            try:
                source = SourceEvidence(
                    source_id=f"source-{len(sources) + 1}",
                    title=title.strip()[:500] or "未命名来源",
                    url=normalized_url,
                    content=content.strip()[:6_000],
                    published_date=(
                        str(raw["published_date"]).strip()[:80]
                        if raw.get("published_date") is not None
                        else None
                    ),
                    score=float(raw["score"]) if raw.get("score") is not None else None,
                )
            except (TypeError, ValueError):
                continue
            sources.append(source)
            if len(sources) >= requested:
                break
        return sources

    @staticmethod
    def tool_result(sources: Sequence[SourceEvidence]) -> str:
        """Return a model-readable result without leaking provider internals."""

        return json.dumps(
            {"sources": [source.prompt_card() for source in sources]},
            ensure_ascii=False,
            separators=(",", ":"),
        )
