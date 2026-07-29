from pydantic import BaseModel, ConfigDict, Field


class RunPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    require_content_approval: bool = False
    max_revision_loops: int = Field(default=1, ge=0, le=3)
    max_model_calls: int = Field(default=8, ge=1, le=32)
    allow_remote_publish: bool = False

    def model_post_init(self, __context: object) -> None:
        if self.allow_remote_publish:
            raise ValueError("The first runtime version never allows remote publishing")

