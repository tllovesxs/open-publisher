from open_publisher_runtime.application.web_search import SourceEvidence
from open_publisher_runtime.workflows.evidence_ledgers import (
    build_evidence_ledgers,
    fact_ledger_summary,
    source_ledger_summary,
)


def test_ledgers_keep_author_material_and_tool_evidence_separate() -> None:
    source = SourceEvidence(
        source_id="source-1",
        title="example/wandao · GitHub repository",
        url="https://github.com/example/wandao",
        content=(
            "万能导用于多平台知识库的 Markdown 导入导出。\n"
            "它保留目录、正文、图片与附件。"
        ),
        published_date="2026-08-04",
    )

    source_ledger, fact_ledger = build_evidence_ledgers(
        author_material="项目目前聚焦本地知识库迁移。\n不承诺企业级部署。",
        source_evidence=[source],
        source_origins={"source-1": "github_repository"},
    )

    assert source_ledger.schema_version == "source_ledger.v1"
    assert [entry.source_id for entry in source_ledger.sources] == [
        "author-material",
        "source-1",
    ]
    assert source_ledger.sources[0].status == "user_provided"
    assert source_ledger.sources[1].kind == "github_repository"
    assert source_ledger.sources[1].status == "verified"
    assert source_ledger.sources[1].untrusted_data is True

    assert fact_ledger.schema_version == "fact_ledger.v1"
    assert [fact.status for fact in fact_ledger.facts] == [
        "user_provided",
        "user_provided",
        "verified",
        "verified",
    ]
    assert all(fact.allowed_as_fact for fact in fact_ledger.facts)
    assert fact_ledger.facts[-1].source_ids == ["source-1"]
    assert "企业级" not in fact_ledger.facts[-1].claim
    assert source_ledger_summary(source_ledger) == {
        "source_count": 2,
        "author_material_count": 1,
        "verified_source_count": 1,
        "web_search_count": 0,
        "github_repository_count": 1,
    }
    assert fact_ledger_summary(fact_ledger) == {
        "fact_count": 4,
        "allowed_fact_count": 4,
        "verified_fact_count": 2,
        "user_provided_fact_count": 2,
    }
