import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

OptionalWorkflowNodeId = Literal[
    "research",
    "outline",
    "natural-style",
    "review",
    "visual",
]

WorkflowNodeId = Literal[
    "research",
    "outline",
    "draft",
    "natural-style",
    "review",
    "risk",
    "visual",
]

VisualImageMode = Literal["none", "auto", "fixed"]
WebSearchMode = Literal["off", "auto", "required"]

_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_-]{0,99}$")


def _normalize_visible_text(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if not normalized or any(
        character not in {"\n", "\t"} and not character.isprintable()
        for character in normalized
    ):
        raise ValueError(f"{field_name} must contain visible text only")
    return normalized


class WorkflowSkillInstruction(BaseModel):
    """A declarative Skill snapshot supplied by the desktop client for one run."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    instructions: str = Field(min_length=1, max_length=6000)

    @field_validator("id")
    @classmethod
    def identifier_is_valid(cls, value: str) -> str:
        normalized = value.strip()
        if not _IDENTIFIER.fullmatch(normalized):
            raise ValueError("skill id must be a lowercase identifier")
        return normalized

    @field_validator("name", "instructions")
    @classmethod
    def visible_text_is_bounded(cls, value: str, info) -> str:
        return _normalize_visible_text(value, field_name=info.field_name)


class WorkflowAgentInstruction(BaseModel):
    """An Agent configuration snapshot that can affect only its assigned node."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(min_length=1, max_length=120)
    node_id: WorkflowNodeId
    prompt: str = Field(min_length=1, max_length=6000)
    skills: list[WorkflowSkillInstruction] = Field(default_factory=list, max_length=12)

    @field_validator("id")
    @classmethod
    def identifier_is_valid(cls, value: str) -> str:
        normalized = value.strip()
        if not _IDENTIFIER.fullmatch(normalized):
            raise ValueError("agent id must be a lowercase identifier")
        return normalized

    @field_validator("name", "role", "prompt")
    @classmethod
    def visible_text_is_bounded(cls, value: str, info) -> str:
        return _normalize_visible_text(value, field_name=info.field_name)

    @field_validator("skills")
    @classmethod
    def skill_ids_are_unique(
        cls,
        value: list[WorkflowSkillInstruction],
    ) -> list[WorkflowSkillInstruction]:
        if len({skill.id for skill in value}) != len(value):
            raise ValueError("agent skill ids must be unique")
        return value


class VisualAssetInstruction(BaseModel):
    """Text-only metadata for a locally held image selected by the author."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100)
    alt: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=600)

    @field_validator("id")
    @classmethod
    def identifier_is_valid(cls, value: str) -> str:
        normalized = value.strip()
        if not _IDENTIFIER.fullmatch(normalized):
            raise ValueError("visual asset id must be a lowercase identifier")
        return normalized

    @field_validator("alt")
    @classmethod
    def alt_is_visible_text(cls, value: str) -> str:
        return _normalize_visible_text(value, field_name="alt")

    @field_validator("description")
    @classmethod
    def description_is_bounded(cls, value: str) -> str:
        normalized = value.strip()
        if any(
            character not in {"\n", "\t"} and not character.isprintable()
            for character in normalized
        ):
            raise ValueError("description must contain visible text only")
        return normalized


class VisualCompositionRequest(BaseModel):
    """Immutable image-placement brief captured with one workflow run."""

    model_config = ConfigDict(extra="forbid")

    mode: VisualImageMode = "none"
    target_count: int = Field(default=0, ge=0, le=6)
    assets: list[VisualAssetInstruction] = Field(default_factory=list, max_length=6)

    @field_validator("assets")
    @classmethod
    def asset_ids_are_unique(
        cls,
        value: list[VisualAssetInstruction],
    ) -> list[VisualAssetInstruction]:
        if len({asset.id for asset in value}) != len(value):
            raise ValueError("visual asset ids must be unique")
        return value

    def model_post_init(self, __context: object) -> None:
        if self.mode == "none" and self.target_count != 0:
            raise ValueError("visual target_count must be zero when mode is none")
        if self.mode == "auto" and self.target_count != 0:
            raise ValueError("visual target_count must be zero when mode is auto")
        if self.mode == "fixed" and not 1 <= self.target_count <= 6:
            raise ValueError("visual target_count must be between 1 and 6 when mode is fixed")


class RunPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require_content_approval: bool = False
    max_revision_loops: int = Field(default=1, ge=0, le=3)
    max_model_calls: int = Field(default=8, ge=1, le=32)
    max_parallel: int = Field(default=4, ge=1, le=8)
    web_search_mode: WebSearchMode = "auto"
    max_web_search_calls: int = Field(default=2, ge=0, le=3)
    max_wall_clock_seconds: int = Field(default=300, ge=1, le=3600)
    allow_remote_publish: bool = False
    disabled_optional_node_ids: list[OptionalWorkflowNodeId] = Field(
        default_factory=lambda: [
            "research",
            "outline",
            "natural-style",
            "review",
            "visual",
        ],
        max_length=5,
    )
    agent_instructions: list[WorkflowAgentInstruction] = Field(
        default_factory=list,
        max_length=12,
    )
    visual_composition: VisualCompositionRequest = Field(
        default_factory=VisualCompositionRequest,
    )

    @field_validator("disabled_optional_node_ids")
    @classmethod
    def disabled_optional_node_ids_must_be_unique(
        cls,
        value: list[OptionalWorkflowNodeId],
    ) -> list[OptionalWorkflowNodeId]:
        if len(value) != len(set(value)):
            raise ValueError("disabled_optional_node_ids must not contain duplicates")
        return value

    @field_validator("agent_instructions")
    @classmethod
    def agent_instructions_are_bounded(
        cls,
        value: list[WorkflowAgentInstruction],
    ) -> list[WorkflowAgentInstruction]:
        if len({agent.id for agent in value}) != len(value):
            raise ValueError("agent instruction ids must be unique")
        total_characters = sum(
            len(agent.name)
            + len(agent.role)
            + len(agent.prompt)
            + sum(len(skill.name) + len(skill.instructions) for skill in agent.skills)
            for agent in value
        )
        if total_characters > 48_000:
            raise ValueError("agent instruction snapshot exceeds the 48000 character limit")
        return value

    def model_post_init(self, __context: object) -> None:
        if self.allow_remote_publish:
            raise ValueError("The first runtime version never allows remote publishing")
