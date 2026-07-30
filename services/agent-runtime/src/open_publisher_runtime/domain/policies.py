from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

OptionalWorkflowNodeId = Literal[
    "research",
    "outline",
    "natural-style",
    "review",
    "visual",
]


class RunPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require_content_approval: bool = False
    max_revision_loops: int = Field(default=1, ge=0, le=3)
    max_model_calls: int = Field(default=8, ge=1, le=32)
    max_parallel: int = Field(default=4, ge=1, le=8)
    max_wall_clock_seconds: int = Field(default=300, ge=1, le=3600)
    allow_remote_publish: bool = False
    disabled_optional_node_ids: list[OptionalWorkflowNodeId] = Field(
        default_factory=list,
        max_length=5,
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

    def model_post_init(self, __context: object) -> None:
        if self.allow_remote_publish:
            raise ValueError("The first runtime version never allows remote publishing")
