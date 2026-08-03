"""Pinned prompt resource for the primary Article Agent.

The writing prompt is a versioned runtime resource rather than a string hidden
inside the workflow implementation. The loader deliberately exposes no
caller-controlled path: a workflow can only load this package-owned resource.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from typing import Final

from pydantic import BaseModel, ConfigDict, Field

_RESOURCE_PARTS: Final = ("resources", "prompts", "article-writer", "v1.md")
_MAX_RESOURCE_BYTES: Final = 24_000
_PLACEHOLDER_PATTERN = re.compile(r"{{(?P<name>[a-z_]+)}}")
_HEADER_PATTERN = re.compile(
    r"\A<!-- open-publisher-prompt\n"
    r"id: (?P<id>[a-z][a-z0-9.-]{2,80})\n"
    r"version: (?P<version>\d+\.\d+\.\d+)\n"
    r"-->\n",
    re.ASCII,
)
_EXPECTED_PLACEHOLDERS: Final = frozenset(
    {
        "writing_brief",
        "author_material",
        "reference_instruction",
        "evidence_instruction",
        "search_instruction",
        "agent_guidance",
    }
)


class WriterPromptProvenance(BaseModel):
    """Immutable identifier for the prompt resource used by one workflow run."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(pattern=r"^[a-z][a-z0-9.-]{2,80}$")
    version: str = Field(pattern=r"^\d+\.\d+\.\d+$")
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class WriterPromptTemplate:
    """A validated template with a bounded, explicit interpolation surface."""

    provenance: WriterPromptProvenance
    template: str

    def render(self, **values: str) -> str:
        unknown = set(values).difference(_EXPECTED_PLACEHOLDERS)
        missing = _EXPECTED_PLACEHOLDERS.difference(values)
        if unknown or missing:
            details = []
            if unknown:
                details.append(f"unknown={','.join(sorted(unknown))}")
            if missing:
                details.append(f"missing={','.join(sorted(missing))}")
            raise ValueError(f"invalid article writer prompt values ({'; '.join(details)})")
        if any(not isinstance(value, str) for value in values.values()):
            raise TypeError("article writer prompt values must be text")

        def replace(match: re.Match[str]) -> str:
            return values[match.group("name")]

        # Interpolate in one pass only. Author material may legitimately use
        # Mustache-like examples, which must stay data rather than becoming
        # a second interpolation pass.
        return _PLACEHOLDER_PATTERN.sub(replace, self.template)


def _resource_bytes() -> bytes:
    """Read one package-owned resource without accepting a filesystem path."""

    return files("open_publisher_runtime").joinpath(*_RESOURCE_PARTS).read_bytes()


@lru_cache(maxsize=1)
def load_article_writer_prompt() -> WriterPromptTemplate:
    """Load and validate the versioned writer prompt bundled with the runtime."""

    data = _resource_bytes()
    if not data or len(data) > _MAX_RESOURCE_BYTES or b"\x00" in data:
        raise ValueError("article writer prompt resource is invalid")
    try:
        resource = data.decode("utf-8")
    except UnicodeDecodeError as error:  # pragma: no cover - package resource is UTF-8
        raise ValueError("article writer prompt resource must be UTF-8") from error
    header = _HEADER_PATTERN.match(resource)
    if header is None:
        raise ValueError("article writer prompt resource has an invalid header")
    template = resource[header.end() :].strip()
    placeholders = [match.group("name") for match in _PLACEHOLDER_PATTERN.finditer(template)]
    if (
        len(placeholders) != len(_EXPECTED_PLACEHOLDERS)
        or set(placeholders) != _EXPECTED_PLACEHOLDERS
    ):
        raise ValueError("article writer prompt resource has an invalid placeholder set")
    return WriterPromptTemplate(
        provenance=WriterPromptProvenance(
            id=header.group("id"),
            version=header.group("version"),
            sha256=hashlib.sha256(data).hexdigest(),
        ),
        template=template,
    )
