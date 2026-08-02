from __future__ import annotations

import base64
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlparse

import httpx

from open_publisher_runtime.application.web_search import SourceEvidence

_REPOSITORY_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
_COMMIT_SHA = re.compile(r"^[0-9a-fA-F]{7,64}$")
_MAX_RESPONSE_BYTES = 1_500_000
_MAX_README_BASE64_BYTES = 120_000


def _visible_text(value: object, *, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split()).strip()[:limit]


def _repository_identity(repository: str) -> tuple[str, str]:
    """Accept a public GitHub repository URL or a compact owner/repository reference."""

    normalized = repository.strip()
    if not normalized or len(normalized) > 1_000:
        raise ValueError("GitHub repository must contain an owner and repository name")
    parsed = urlparse(normalized)
    if parsed.scheme:
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443}
            or parsed.hostname not in {"github.com", "www.github.com"}
        ):
            raise ValueError("GitHub repository URL must use https://github.com")
        parts = [unquote(part) for part in parsed.path.split("/") if part]
    else:
        parts = normalized.split("/")
    if len(parts) < 2:
        raise ValueError("GitHub repository must use owner/repository format")
    owner, name = parts[:2]
    name = name.removesuffix(".git")
    if not _REPOSITORY_PART.fullmatch(owner) or not _REPOSITORY_PART.fullmatch(name):
        raise ValueError("GitHub repository owner or name is invalid")
    return owner, name


def _source(
    *,
    source_id: str,
    title: str,
    url: str,
    content: str,
    published_date: str | None = None,
) -> SourceEvidence:
    return SourceEvidence(
        source_id=source_id,
        title=title[:500],
        url=url,
        content=content[:6_000] or "GitHub returned an empty public metadata record.",
        published_date=published_date[:80] if published_date else None,
    )


@dataclass(frozen=True, slots=True)
class GitHubRepositoryTool:
    """Read bounded, public repository context from GitHub's fixed REST API."""

    api_token: str | None = None
    timeout_seconds: float = 20.0
    max_recent_commits: int = 5

    name: str = "github_repository"
    description: str = (
        "Read authoritative public GitHub repository context. Use this first when the author "
        "provides a GitHub repository URL or asks about a named open-source project's current "
        "description, README, release notes, or recent changes."
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
                        "repository": {
                            "type": "string",
                            "description": (
                                "A GitHub repository URL or owner/repository identifier."
                            ),
                        },
                    },
                    "required": ["repository"],
                    "additionalProperties": False,
                },
            },
        }

    def _headers(self) -> dict[str, str]:
        headers = {
            "Accept": "application/vnd.github+json",
            "User-Agent": "Open-Publisher-Writer/0.1",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"
        return headers

    def _get_json(self, path: str, *, missing_is_empty: bool) -> object | None:
        response = httpx.get(
            f"https://api.github.com{path}",
            headers=self._headers(),
            follow_redirects=False,
            timeout=self.timeout_seconds,
        )
        if missing_is_empty and getattr(response, "status_code", None) == 404:
            return None
        response.raise_for_status()
        content = getattr(response, "content", b"")
        if isinstance(content, bytes) and len(content) > _MAX_RESPONSE_BYTES:
            raise RuntimeError("GitHub returned a response that exceeds the safe size limit")
        payload = response.json()
        if not isinstance(payload, (dict, list)):
            raise RuntimeError("GitHub returned an invalid API response")
        return payload

    def inspect(self, repository: str) -> list[SourceEvidence]:
        owner, name = _repository_identity(repository)
        owner_path, name_path = quote(owner, safe=""), quote(name, safe="")
        api_root = f"/repos/{owner_path}/{name_path}"
        repository_data = self._get_json(api_root, missing_is_empty=False)
        if not isinstance(repository_data, dict):
            raise RuntimeError("GitHub returned an invalid repository record")

        default_branch = _visible_text(repository_data.get("default_branch"), limit=160) or "main"
        public_url = f"https://github.com/{owner_path}/{name_path}"
        topics = repository_data.get("topics")
        normalized_topics = (
            [_visible_text(item, limit=80) for item in topics if _visible_text(item, limit=80)]
            if isinstance(topics, list)
            else []
        )
        topic_text = ", ".join(normalized_topics)
        description = _visible_text(repository_data.get("description"), limit=1_000)
        language = _visible_text(repository_data.get("language"), limit=120)
        pushed_at = _visible_text(repository_data.get("pushed_at"), limit=80)
        repository_lines = [
            f"Repository: {owner}/{name}",
            f"Description: {description or 'Not provided'}",
            f"Primary language: {language or 'Not provided'}",
            f"Default branch: {default_branch}",
            f"Last pushed: {pushed_at or 'Not provided'}",
        ]
        if topic_text:
            repository_lines.append(f"Topics: {topic_text[:800]}")
        sources = [
            _source(
                source_id="github-repository",
                title=f"{owner}/{name} · GitHub repository",
                url=public_url,
                content="\n".join(repository_lines),
                published_date=_visible_text(repository_data.get("updated_at"), limit=80) or None,
            )
        ]

        readme = self._get_json(f"{api_root}/readme", missing_is_empty=True)
        if isinstance(readme, dict):
            encoded = readme.get("content")
            encoding = readme.get("encoding")
            if (
                isinstance(encoded, str)
                and encoding == "base64"
                and len(encoded) <= _MAX_README_BASE64_BYTES
            ):
                try:
                    decoded_readme = base64.b64decode(encoded, validate=False)
                    readme_text = decoded_readme.decode("utf-8", "replace")
                except (ValueError, UnicodeDecodeError):
                    readme_text = ""
                if readme_text.strip():
                    readme_path = quote(default_branch, safe="")
                    sources.append(
                        _source(
                            source_id="github-readme",
                            title=f"{owner}/{name} · README",
                            url=f"{public_url}/blob/{readme_path}/README.md",
                            content=readme_text.strip(),
                        )
                    )

        release = self._get_json(f"{api_root}/releases/latest", missing_is_empty=True)
        if isinstance(release, dict):
            tag = _visible_text(release.get("tag_name"), limit=160)
            release_name = _visible_text(release.get("name"), limit=500)
            released_at = _visible_text(release.get("published_at"), limit=80)
            release_lines = [
                f"Release: {release_name or tag or 'Unnamed release'}",
                f"Tag: {tag or 'Not provided'}",
                f"Published: {released_at or 'Not provided'}",
                _visible_text(release.get("body"), limit=5_000),
            ]
            sources.append(
                _source(
                    source_id="github-release",
                    title=f"{owner}/{name} · latest release",
                    url=f"{public_url}/releases/tag/{quote(tag, safe='') if tag else 'latest'}",
                    content="\n".join(line for line in release_lines if line),
                    published_date=_visible_text(release.get("published_at"), limit=80) or None,
                )
            )

        commits = self._get_json(
            f"{api_root}/commits?per_page={self.max_recent_commits}",
            missing_is_empty=True,
        )
        if isinstance(commits, Sequence) and not isinstance(commits, (str, bytes)):
            commit_lines: list[str] = []
            for item in commits[: self.max_recent_commits]:
                if not isinstance(item, dict):
                    continue
                sha = _visible_text(item.get("sha"), limit=64)
                commit = item.get("commit")
                if not _COMMIT_SHA.fullmatch(sha) or not isinstance(commit, dict):
                    continue
                message = _visible_text(commit.get("message"), limit=600)
                date = ""
                author = commit.get("author")
                if isinstance(author, dict):
                    date = _visible_text(author.get("date"), limit=80)
                if message:
                    commit_lines.append(f"- {sha[:12]} | {date or 'unknown date'} | {message}")
            if commit_lines:
                sources.append(
                    _source(
                        source_id="github-commits",
                        title=f"{owner}/{name} · recent commits",
                        url=f"{public_url}/commits/{quote(default_branch, safe='')}",
                        content="\n".join(commit_lines),
                    )
                )
        return sources

    @staticmethod
    def tool_result(sources: Sequence[SourceEvidence]) -> str:
        return json.dumps(
            {"sources": [source.prompt_card() for source in sources]},
            ensure_ascii=False,
            separators=(",", ":"),
        )
