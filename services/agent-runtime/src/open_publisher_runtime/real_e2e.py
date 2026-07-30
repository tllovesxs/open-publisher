from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4

from open_publisher_runtime.application.articles import ArticleService
from open_publisher_runtime.application.artifacts import ArtifactService
from open_publisher_runtime.application.content_package_directory import (
    ContentPackageDirectoryService,
)
from open_publisher_runtime.application.content_packages import ContentPackageService
from open_publisher_runtime.application.harness import (
    WORKFLOW_ARTIFACT_STATE_KEYS,
    RunController,
    WorkflowService,
)
from open_publisher_runtime.application.images import ImageGenerationService
from open_publisher_runtime.application.model_access import (
    ModelAccessLayer,
    TextGenerationRequest,
    TextGenerationResponse,
)
from open_publisher_runtime.application.publishing import (
    DeterministicDryRunPublisher,
    PublishOutboxService,
    PublishTarget,
)
from open_publisher_runtime.domain.enums import (
    ApprovalStatus,
    PublishJobState,
    RunStatus,
)
from open_publisher_runtime.domain.policies import RunPolicy
from open_publisher_runtime.infrastructure.artifact_store import FileSystemArtifactStore
from open_publisher_runtime.infrastructure.database import Database
from open_publisher_runtime.infrastructure.providers import (
    OpenAICompatibleImageProvider,
    OpenAICompatibleTextProvider,
)
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.workflows.preset import PresetArticleWorkflow

DEFAULT_BASE_URL = "https://api.siliconflow.cn/v1"
DEFAULT_TEXT_MODEL = "deepseek-ai/DeepSeek-V3.2"
DEFAULT_IMAGE_MODEL = "Qwen/Qwen-Image"
API_KEY_ENV = "OPEN_PUBLISHER_SILICONFLOW_API_KEY"


@dataclass
class UsageTrackingTextProvider:
    provider: OpenAICompatibleTextProvider
    call_count: int = 0
    input_tokens: int = 0
    output_tokens: int = 0

    @property
    def name(self) -> str:
        return self.provider.name

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        call_started = monotonic()
        print(f"[real-e2e] text:start purpose={request.purpose}", flush=True)
        try:
            response = self.provider.generate(request)
        except Exception as error:
            print(
                (
                    f"[real-e2e] text:failed purpose={request.purpose} "
                    f"elapsed={monotonic() - call_started:.1f}s "
                    f"error={type(error).__name__}"
                ),
                flush=True,
            )
            raise
        self.call_count += 1
        self.input_tokens += response.usage.get("input_tokens", 0)
        self.output_tokens += response.usage.get("output_tokens", 0)
        print(
            (
                f"[real-e2e] text:ok purpose={request.purpose} "
                f"elapsed={monotonic() - call_started:.1f}s "
                f"tokens={response.usage.get('output_tokens', 0)}"
            ),
            flush=True,
        )
        return response


def _default_output_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Path(".local") / "real-e2e" / f"{stamp}-{uuid4().hex[:8]}"


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run_real_e2e(
    *,
    api_key: str,
    output_dir: Path,
    base_url: str,
    text_model: str,
    image_model: str,
) -> dict[str, Any]:
    started = monotonic()
    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise FileExistsError("real E2E output directory must not already exist")
    output_dir.mkdir(parents=True)

    database_path = output_dir / "runtime.sqlite3"
    artifact_root = output_dir / "artifact-store"
    package_root = output_dir / "content-package"
    database = Database(f"sqlite:///{database_path.as_posix()}")
    database.create_schema()
    blob_store = FileSystemArtifactStore(artifact_root)

    tracking_text = UsageTrackingTextProvider(
        OpenAICompatibleTextProvider(
            base_url=base_url,
            api_key=api_key,
            default_model=text_model,
            timeout_seconds=600,
            max_output_tokens=1400,
        )
    )
    image_provider = OpenAICompatibleImageProvider(
        base_url=base_url,
        api_key=api_key,
        default_model=image_model,
        timeout_seconds=240,
        trusted_image_hosts=frozenset({"s3.siliconflow.cn"}),
        size_field="image_size",
        response_format=None,
        extra_request_fields={
            "batch_size": 1,
            "num_inference_steps": 20,
            "guidance_scale": 4.0,
        },
    )
    model_access = ModelAccessLayer(
        text_provider=tracking_text,
        image_provider=image_provider,
    )

    persisted: dict[str, str] = {}
    report: dict[str, Any]
    try:
        with database.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            artifacts = ArtifactService(repository, blob_store)
            articles = ArticleService(repository, artifacts)
            workflow = WorkflowService(repository).ensure_presets()
            controller = RunController(
                repository=repository,
                artifact_service=artifacts,
                article_service=articles,
                workflow_runner=PresetArticleWorkflow(model_access),
            )
            publishing = PublishOutboxService(
                repository=repository,
                artifact_service=artifacts,
                publisher=DeterministicDryRunPublisher(),
            )

            article, input_revision = articles.create_article(
                title="从一份 Markdown 到三个内容平台",
                markdown=(
                    "# 原始素材\n\n"
                    "我正在设计一个本地优先的开源写作工具。它需要保留人工审核，"
                    "把同一份 Markdown 转换成平台稿，并让发布任务可追踪、可重试。"
                ),
                metadata={"test_scope": "real-model-local-publish-e2e"},
            )
            run = controller.start(
                workflow_id=workflow.id,
                article_id=article.id,
                revision_id=input_revision.id,
                topic="本地优先的多 Agent 写作与可审计多平台发布",
                policy=RunPolicy(
                    require_content_approval=True,
                    max_model_calls=7,
                    max_parallel=3,
                    max_wall_clock_seconds=1800,
                ),
            )
            _assert(
                run.status is RunStatus.WAITING_APPROVAL,
                f"workflow did not pause for review: {run.error or run.status.value}",
            )
            _assert(
                run.approval_status is ApprovalStatus.PENDING,
                "workflow approval was not pending",
            )
            run = controller.resume(
                run_id=run.id,
                action="approve",
                comment="real E2E human-review boundary exercised",
            )
            _assert(run.status is RunStatus.COMPLETED, "workflow did not complete after approval")
            _assert(run.output_revision_id is not None, "workflow output revision is missing")
            output_revision = repository.get_revision(run.output_revision_id)
            _assert(output_revision is not None, "workflow output revision was not persisted")
            assert output_revision is not None

            workflow_artifact_ids = [
                str(run.state_json[key])
                for key in WORKFLOW_ARTIFACT_STATE_KEYS
                if run.state_json.get(key)
            ]
            _assert(len(workflow_artifact_ids) == 8, "workflow Artifact handoff is incomplete")
            for artifact_id in workflow_artifact_ids:
                _assert(
                    repository.get_artifact(artifact_id) is not None,
                    f"workflow Artifact {artifact_id} is missing",
                )

            image_result = ImageGenerationService(
                model_access=model_access,
                artifact_service=artifacts,
            ).generate(
                prompt=(
                    "A clean editorial illustration for an open source article publishing "
                    "workbench: one Markdown document flowing into three publishing channels, "
                    "warm white background, coral accents, precise flat shapes, no text, no logos"
                ),
                size="1024x1024",
                model=image_model,
            )
            _assert(not image_result.mocked, "image provider unexpectedly used mock output")
            _assert(len(image_result.artifacts) == 1, "real image Artifact was not stored")
            image_artifact = image_result.artifacts[0]
            image_bytes = artifacts.read_bytes(image_artifact.id)
            _assert(len(image_bytes) > 1024, "generated image payload is unexpectedly small")

            plan, variants = publishing.create_plan(
                revision_id=output_revision.id,
                targets=[
                    PublishTarget(platform="csdn", account_ref="real-e2e-csdn"),
                    PublishTarget(platform="wechat", account_ref="real-e2e-wechat"),
                    PublishTarget(platform="toutiao", account_ref="real-e2e-toutiao"),
                ],
                selected_asset_ids=[image_artifact.id],
            )
            plan = publishing.approve(
                plan.id,
                actor_id="user:real-e2e",
                comment="three platform previews and generated cover confirmed",
                source="real-integration-test",
            )
            grant = plan.plan_json.get("approval_grant")
            _assert(isinstance(grant, dict), "approval grant is missing")
            assert isinstance(grant, dict)
            _assert(
                grant.get("selected_asset_hashes") == [image_artifact.content_hash],
                "generated image hash was not bound to approval",
            )

            first_jobs = publishing.enqueue(plan.id)
            second_jobs = publishing.enqueue(plan.id)
            _assert(
                [job.id for job in first_jobs] == [job.id for job in second_jobs],
                "repeated enqueue did not reuse idempotent jobs",
            )
            receipts = []
            for job in first_jobs:
                processed, receipt = publishing.process(job.id)
                _assert(
                    processed.state is PublishJobState.SUCCEEDED,
                    f"dry-run job {job.id} did not succeed",
                )
                _assert(receipt is not None, f"dry-run job {job.id} has no receipt")
                assert receipt is not None
                _assert(receipt.remote_url is None, "dry-run receipt unexpectedly has a remote URL")
                receipts.append(receipt)

            package = ContentPackageService(repository, artifacts, articles).export(
                article_id=article.id,
                revision_id=output_revision.id,
                artifact_ids=[image_artifact.id],
                platform_variant_ids=[variant.id for variant in variants],
            )
            package_result = ContentPackageDirectoryService().materialize(package, package_root)
            verified_manifest = ContentPackageDirectoryService().verify(package_root)
            _assert(
                package_result.manifest["packageHash"] == verified_manifest["packageHash"],
                "ContentPackage verification hash differs from materialization",
            )

            persisted = {
                "run_id": run.id,
                "plan_id": plan.id,
                "image_artifact_id": image_artifact.id,
                **{f"job_{index}": job.id for index, job in enumerate(first_jobs)},
            }
            report = {
                "schema_version": "open-publisher.real-e2e.v1",
                "result": "passed",
                "external_calls": {
                    "text_provider": "siliconflow",
                    "text_model": text_model,
                    "text_calls": tracking_text.call_count,
                    "input_tokens": tracking_text.input_tokens,
                    "output_tokens": tracking_text.output_tokens,
                    "image_provider": "siliconflow",
                    "image_model": image_model,
                    "image_calls": 1,
                },
                "workflow": {
                    "id": run.id,
                    "engine": run.state_json.get("engine"),
                    "status": run.status.value,
                    "approval_status": run.approval_status.value,
                    "artifact_count": len(workflow_artifact_ids),
                    "output_revision_hash": output_revision.content_hash,
                },
                "image": {
                    "artifact_id": image_artifact.id,
                    "content_hash": image_artifact.content_hash,
                    "media_type": image_artifact.media_type,
                    "size_bytes": image_artifact.size_bytes,
                    "mocked": image_result.mocked,
                },
                "publishing": {
                    "mode": "dry_run",
                    "remote_platform_write_performed": False,
                    "plan_id": plan.id,
                    "approval_binding_hash": grant["binding_hash"],
                    "platforms": [variant.platform for variant in variants],
                    "job_ids": [job.id for job in first_jobs],
                    "idempotent_reenqueue": True,
                    "receipt_statuses": [receipt.status for receipt in receipts],
                },
                "content_package": {
                    "package_id": package.package_id,
                    "package_hash": verified_manifest["packageHash"],
                    "entry_count": len(verified_manifest["entries"]),
                    "verified": True,
                },
            }
    finally:
        database.dispose()

    reopened = Database(f"sqlite:///{database_path.as_posix()}")
    try:
        with reopened.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            durable_run = repository.get_run(persisted["run_id"])
            durable_plan = repository.get_publish_plan(persisted["plan_id"])
            durable_image = repository.get_artifact(persisted["image_artifact_id"])
            durable_jobs = [
                repository.get_publish_job(job_id)
                for key, job_id in persisted.items()
                if key.startswith("job_")
            ]
            _assert(
                durable_run is not None and durable_run.status is RunStatus.COMPLETED,
                "workflow was not durable after database reopen",
            )
            _assert(durable_plan is not None, "publish plan was not durable after database reopen")
            _assert(
                durable_image is not None,
                "image Artifact was not durable after database reopen",
            )
            _assert(
                all(
                    job is not None and job.state is PublishJobState.SUCCEEDED
                    for job in durable_jobs
                ),
                "publish jobs were not durable after database reopen",
            )
            for job in durable_jobs:
                assert job is not None
                _assert(
                    repository.get_publish_receipt_for_job(job.id) is not None,
                    f"receipt for job {job.id} was not durable",
                )
    finally:
        reopened.dispose()

    report["durability"] = {
        "sqlite_reopened": True,
        "workflow": True,
        "image_artifact": True,
        "jobs_and_receipts": True,
    }
    report["elapsed_seconds"] = round(monotonic() - started, 3)
    report_path = output_dir / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {**report, "output_dir": str(output_dir), "report_path": str(report_path)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run real SiliconFlow text/image calls through the local workflow and dry-run outbox."
        )
    )
    parser.add_argument(
        "--confirm-external-model-calls",
        action="store_true",
        help="Required opt-in. This command sends the test prompts to SiliconFlow.",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--text-model", default=DEFAULT_TEXT_MODEL)
    parser.add_argument("--image-model", default=DEFAULT_IMAGE_MODEL)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.confirm_external_model_calls:
        raise SystemExit("refusing external model calls without --confirm-external-model-calls")
    api_key = os.getenv(API_KEY_ENV, "").strip()
    if not api_key:
        raise SystemExit(f"{API_KEY_ENV} is required and is never read from a repository file")
    report = run_real_e2e(
        api_key=api_key,
        output_dir=args.output_dir or _default_output_dir(),
        base_url=args.base_url,
        text_model=args.text_model,
        image_model=args.image_model,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
