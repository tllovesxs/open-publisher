from sqlalchemy import select

from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.harness import WORKFLOW_ARTIFACT_STATE_KEYS
from open_publisher_runtime.infrastructure.orm import ArtifactORM
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository


def test_same_blob_creates_distinct_logical_artifacts_across_kinds(client) -> None:
    blob_store = client.app.state.container.blob_store
    with client.app.state.container.database.session() as session:
        repository = SqlAlchemyRuntimeRepository(session)
        artifacts = ArtifactService(repository, blob_store)
        first = artifacts.put_text(
            kind="workflow.review-report",
            text="identical payload",
            metadata={"run_id": "run:first"},
        )
        second = artifacts.put_text(
            kind="workflow.risk-report",
            text="identical payload",
            metadata={"run_id": "run:second"},
        )

        assert first.id != second.id
        assert first.content_hash == second.content_hash
        assert first.storage_path == second.storage_path
        assert first.kind == "workflow.review-report"
        assert first.metadata_json == {"run_id": "run:first"}
        assert second.kind == "workflow.risk-report"
        assert second.metadata_json == {"run_id": "run:second"}
        assert artifacts.read_text(first.id) == "identical payload"
        assert artifacts.read_text(second.id) == "identical payload"

        stored = session.scalars(
            select(ArtifactORM).where(
                ArtifactORM.content_hash == first.content_hash,
            )
        ).all()
        assert len(stored) == 2

    blob_files = [path for path in blob_store.root.rglob("*") if path.is_file()]
    assert len(blob_files) == 1


def test_identical_workflow_outputs_keep_per_run_artifact_lineage(
    client,
    article_payload,
) -> None:
    workflow = client.get("/api/v1/workflows").json()[0]
    runs = []
    for _ in range(2):
        article = client.post("/api/v1/articles", json=article_payload).json()
        response = client.post(
            "/api/v1/runs",
            json={
                "workflow_id": workflow["id"],
                "article_id": article["article"]["id"],
                "revision_id": article["revision"]["id"],
                "topic": "相同输入的独立运行",
            },
        )
        assert response.status_code == 201, response.text
        assert response.json()["status"] == "completed"
        runs.append(response.json())

    with client.app.state.container.database.session() as session:
        repository = SqlAlchemyRuntimeRepository(session)
        for state_key in WORKFLOW_ARTIFACT_STATE_KEYS:
            first = repository.get_artifact(runs[0]["state_json"][state_key])
            second = repository.get_artifact(runs[1]["state_json"][state_key])
            assert first is not None
            assert second is not None
            assert first.id != second.id
            assert first.content_hash == second.content_hash
            assert first.storage_path == second.storage_path
            assert first.kind == second.kind
            assert first.metadata_json["run_id"] == runs[0]["id"]
            assert second.metadata_json["run_id"] == runs[1]["id"]
