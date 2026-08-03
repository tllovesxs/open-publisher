import hashlib
from importlib.resources import files

from open_publisher_runtime.workflows.article_writer_prompt import (
    load_article_writer_prompt,
)


def test_article_writer_prompt_resource_is_versioned_and_renders_only_known_slots() -> None:
    prompt = load_article_writer_prompt()

    assert prompt.provenance.id == "article-writer"
    assert prompt.provenance.version == "1.0.0"
    assert len(prompt.provenance.sha256) == 64
    resource_bytes = files("open_publisher_runtime").joinpath(
        "resources", "prompts", "article-writer", "v1.md"
    ).read_bytes()
    assert prompt.provenance.sha256 == hashlib.sha256(resource_bytes).hexdigest()

    rendered = prompt.render(
        writing_brief="标题：测试",
        author_material="只知道写文、配图和发布，项目名为 {{project_name}}。",
        reference_instruction="",
        evidence_instruction="",
        search_instruction="",
        agent_guidance="",
    )

    for placeholder in (
        "writing_brief",
        "author_material",
        "reference_instruction",
        "evidence_instruction",
        "search_instruction",
        "agent_guidance",
    ):
        assert f"{{{{{placeholder}}}}}" not in rendered
    assert "不要把用户只提供的“写文、配图、发布”等能力自动扩写" in rendered
    assert "数据中台、三层架构、统一引擎" in rendered
    assert "只知道写文、配图和发布，项目名为 {{project_name}}。" in rendered
