"""Deterministic provenance artifacts for the Article Agent.

These ledgers are deliberately extracted without a second model call. They
record what material entered one run and which bounded statements can be used
as user-provided or source-verified facts. The writer still decides how to
express an allowed fact; no ledger entry is a command to write it.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Mapping, Sequence
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl

from open_publisher_runtime.application.web_search import SourceEvidence

FactStatus = Literal["verified", "user_provided", "inferred", "unknown"]
SourceKind = Literal[
    "author_material",
    "web_search",
    "github_repository",
    "unknown_tool",
]

_MAX_LEDGER_SOURCES = 8
_MAX_FACTS_PER_SOURCE = 6
_MAX_CLAIM_LENGTH = 700
_SENTENCE_BOUNDARY = re.compile(r"(?<=[。！？.!?])\s+|\n+")
_MARKDOWN_PREFIX = re.compile(r"^(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)")
_SPACE = re.compile(r"\s+")


class SourceLedgerEntry(BaseModel):
    """A bounded, untrusted input that was available to the writing run."""

    model_config = ConfigDict(extra="forbid")

    source_id: str = Field(pattern=r"^[a-z][a-z0-9-]{1,99}$")
    kind: SourceKind
    status: FactStatus
    title: str = Field(min_length=1, max_length=500)
    url: HttpUrl | None = None
    excerpt: str = Field(min_length=1, max_length=1_600)
    content_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    published_date: str | None = Field(default=None, max_length=80)
    untrusted_data: bool = True


class SourceLedger(BaseModel):
    """Immutable source inventory stored with one workflow run."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["source_ledger.v1"] = "source_ledger.v1"
    sources: list[SourceLedgerEntry] = Field(default_factory=list, max_length=_MAX_LEDGER_SOURCES)


class FactLedgerEntry(BaseModel):
    """A short claim and the material that supports its publication status."""

    model_config = ConfigDict(extra="forbid")

    fact_id: str = Field(pattern=r"^fact-[0-9]{3}$")
    claim: str = Field(min_length=1, max_length=_MAX_CLAIM_LENGTH)
    status: FactStatus
    source_ids: list[str] = Field(min_length=1, max_length=1)
    allowed_as_fact: bool


class FactLedger(BaseModel):
    """Fact boundary derived from the source ledger without model inference."""

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["fact_ledger.v1"] = "fact_ledger.v1"
    facts: list[FactLedgerEntry] = Field(default_factory=list, max_length=48)


def _visible_excerpt(text: str, *, limit: int) -> str:
    return _SPACE.sub(" ", text).strip()[:limit]


def _content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _source_kind(value: str | None) -> SourceKind:
    if value == "web_search":
        return "web_search"
    if value == "github_repository":
        return "github_repository"
    return "unknown_tool"


def _claim_candidates(text: str) -> list[str]:
    """Extract bounded source statements, without interpreting or combining them."""

    candidates: list[str] = []
    seen: set[str] = set()
    for segment in _SENTENCE_BOUNDARY.split(text):
        claim = _MARKDOWN_PREFIX.sub("", segment.strip())
        claim = _visible_excerpt(claim, limit=_MAX_CLAIM_LENGTH)
        if len(claim) < 4 or claim in seen:
            continue
        seen.add(claim)
        candidates.append(claim)
        if len(candidates) >= _MAX_FACTS_PER_SOURCE:
            break
    return candidates


def build_evidence_ledgers(
    *,
    author_material: str,
    source_evidence: Sequence[SourceEvidence],
    source_origins: Mapping[str, str],
) -> tuple[SourceLedger, FactLedger]:
    """Build traceable ledgers from author material and successful tool results.

    `verified` means a captured external source explicitly contained the claim,
    not that the runtime independently proved the source correct. `unknown` and
    `inferred` remain available status values for future semantic review, but
    are intentionally never created by this deterministic first slice.
    """

    source_entries: list[SourceLedgerEntry] = []
    fact_entries: list[FactLedgerEntry] = []

    def append_facts(*, source_id: str, text: str, status: FactStatus) -> None:
        for claim in _claim_candidates(text):
            fact_entries.append(
                FactLedgerEntry(
                    fact_id=f"fact-{len(fact_entries) + 1:03d}",
                    claim=claim,
                    status=status,
                    source_ids=[source_id],
                    allowed_as_fact=status in {"verified", "user_provided"},
                )
            )

    normalized_author_material = author_material.strip()
    if normalized_author_material:
        source_entries.append(
            SourceLedgerEntry(
                source_id="author-material",
                kind="author_material",
                status="user_provided",
                title="作者提供的素材",
                excerpt=_visible_excerpt(normalized_author_material, limit=1_600),
                content_sha256=_content_hash(normalized_author_material),
            )
        )
        append_facts(
            source_id="author-material",
            text=normalized_author_material,
            status="user_provided",
        )

    for source in source_evidence[: _MAX_LEDGER_SOURCES - len(source_entries)]:
        source_entries.append(
            SourceLedgerEntry(
                source_id=source.source_id,
                kind=_source_kind(source_origins.get(source.source_id)),
                status="verified",
                title=source.title,
                url=source.url,
                excerpt=_visible_excerpt(source.content, limit=1_600),
                content_sha256=_content_hash(source.content),
                published_date=source.published_date,
            )
        )
        append_facts(
            source_id=source.source_id,
            text=source.content,
            status="verified",
        )

    return SourceLedger(sources=source_entries), FactLedger(facts=fact_entries)


def source_ledger_summary(ledger: SourceLedger) -> dict[str, int]:
    """A small run-state summary that does not duplicate the full ledger."""

    return {
        "source_count": len(ledger.sources),
        "author_material_count": sum(
            source.kind == "author_material" for source in ledger.sources
        ),
        "verified_source_count": sum(
            source.status == "verified" for source in ledger.sources
        ),
        "web_search_count": sum(source.kind == "web_search" for source in ledger.sources),
        "github_repository_count": sum(
            source.kind == "github_repository" for source in ledger.sources
        ),
    }


def fact_ledger_summary(ledger: FactLedger) -> dict[str, int]:
    """Expose allowed-fact counts while keeping claims in the immutable artifact."""

    return {
        "fact_count": len(ledger.facts),
        "allowed_fact_count": sum(fact.allowed_as_fact for fact in ledger.facts),
        "verified_fact_count": sum(fact.status == "verified" for fact in ledger.facts),
        "user_provided_fact_count": sum(
            fact.status == "user_provided" for fact in ledger.facts
        ),
    }
