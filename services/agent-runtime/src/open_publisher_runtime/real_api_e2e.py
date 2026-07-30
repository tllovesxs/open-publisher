from __future__ import annotations

import argparse
import json
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic
from typing import Any
from uuid import uuid4

from fastapi.testclient import TestClient

from open_publisher_runtime.application.model_access import (
    TextGenerationRequest,
    TextGenerationResponse,
    TextProvider,
)
from open_publisher_runtime.config import Settings
from open_publisher_runtime.domain.enums import PublishJobState, RunStatus
from open_publisher_runtime.infrastructure.database import Database
from open_publisher_runtime.infrastructure.repository import SqlAlchemyRuntimeRepository
from open_publisher_runtime.main import create_app

API_KEY_ENV = "OPEN_PUBLISHER_SILICONFLOW_API_KEY"
TEXT_MODEL = "deepseek-ai/DeepSeek-V3.2"
IMAGE_MODEL = "Qwen/Qwen-Image"


@dataclass
class ProgressTextProvider:
    provider: TextProvider
    call_count: int = 0

    @property
    def name(self) -> str:
        return self.provider.name

    def generate(self, request: TextGenerationRequest) -> TextGenerationResponse:
        started = monotonic()
        print(f"[real-api-e2e] model:start purpose={request.purpose}", flush=True)
        try:
            response = self.provider.generate(request)
        except Exception as error:
            print(
                (
                    f"[real-api-e2e] model:failed purpose={request.purpose} "
                    f"elapsed={monotonic() - started:.1f}s "
                    f"error={type(error).__name__}"
                ),
                flush=True,
            )
            raise
        self.call_count += 1
        print(
            (
                f"[real-api-e2e] model:ok purpose={request.purpose} "
                f"elapsed={monotonic() - started:.1f}s"
            ),
            flush=True,
        )
        return response


def _default_output_dir() -> Path:
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    return Path(".local") / "real-api-e2e" / f"{stamp}-{uuid4().hex[:8]}"


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run_real_api_e2e(*, output_dir: Path) -> dict[str, Any]:
    api_key = os.getenv(API_KEY_ENV, "").strip()
    if not api_key:
        raise RuntimeError(f"{API_KEY_ENV} is required")

    os.environ.setdefault("OPEN_PUBLISHER_TEXT_BASE_URL", "https://api.siliconflow.cn/v1")
    os.environ.setdefault("OPEN_PUBLISHER_TEXT_MODEL", TEXT_MODEL)
    os.environ.setdefault("OPEN_PUBLISHER_IMAGE_BASE_URL", "https://api.siliconflow.cn/v1")
    os.environ.setdefault("OPEN_PUBLISHER_IMAGE_MODEL", IMAGE_MODEL)
    os.environ.setdefault("OPEN_PUBLISHER_IMAGE_TRUSTED_HOSTS", "s3.siliconflow.cn")
    os.environ.setdefault("OPEN_PUBLISHER_MODEL_TIMEOUT_SECONDS", "600")

    output_dir = output_dir.resolve()
    if output_dir.exists():
        raise FileExistsError("real API E2E output directory must not already exist")
    output_dir.mkdir(parents=True)
    database_path = output_dir / "runtime.sqlite3"
    settings = Settings(
        data_dir=output_dir,
        database_url=f"sqlite:///{database_path.as_posix()}",
        artifact_dir=output_dir / "artifact-store",
        api_token=secrets.token_urlsafe(32),
    )
    app = create_app(settings)
    steps: list[dict[str, Any]] = []
    started = monotonic()

    def request(
        client: TestClient,
        method: str,
        path: str,
        *,
        label: str,
        expected_status: int = 200,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        step_started = monotonic()
        print(f"[real-api-e2e] api:start step={label}", flush=True)
        response = client.request(method, path, json=json_body)
        elapsed = round(monotonic() - step_started, 3)
        if response.status_code != expected_status:
            raise RuntimeError(
                f"API step {label} returned HTTP {response.status_code}: "
                f"{response.text[:240]}"
            )
        steps.append({"step": label, "status": response.status_code, "elapsed_seconds": elapsed})
        print(f"[real-api-e2e] api:ok step={label} elapsed={elapsed:.1f}s", flush=True)
        return response.json()

    persisted: dict[str, Any] = {}
    with TestClient(
        app,
        headers={"Authorization": f"Bearer {settings.api_token}"},
    ) as client:
        progress_provider = ProgressTextProvider(
            client.app.state.container.model_access.text_provider
        )
        client.app.state.container.model_access.text_provider = progress_provider

        health = request(client, "GET", "/health", label="health")
        _require(health["publisher_mode"] == "dry_run", "publisher is not in dry-run mode")

        model = request(
            client,
            "POST",
            "/api/v1/models/test",
            label="model-test",
            json_body={},
        )
        _require(model["mocked"] is False, "text model unexpectedly used a mock provider")

        article_payload = request(
            client,
            "POST",
            "/api/v1/articles",
            label="create-article",
            expected_status=201,
            json_body={
                "title": "本地优先的多平台智能发布",
                "markdown": (
                    "# 创作素材\n\n"
                    "构建一个本地优先的智能写作工具，把同一份 Markdown 适配到"
                    "微信公众号、CSDN 和今日头条。所有发布动作必须经过人工确认，"
                    "发布任务需要有日志、重试和可核验回执。"
                ),
                "metadata": {"source": "real-api-e2e"},
            },
        )
        article_id = article_payload["article"]["id"]
        input_revision_id = article_payload["revision"]["id"]

        workflows = request(
            client,
            "GET",
            "/api/v1/workflows",
            label="list-workflows",
        )
        _require(len(workflows) > 0, "no workflow preset is available")

        run = request(
            client,
            "POST",
            "/api/v1/runs",
            label="run-workflow",
            expected_status=201,
            json_body={
                "workflow_id": workflows[0]["id"],
                "article_id": article_id,
                "revision_id": input_revision_id,
                "topic": "如何设计可靠、可恢复的多平台智能发布流程",
                "policy": {
                    "require_content_approval": False,
                    "max_revision_loops": 1,
                    "max_model_calls": 8,
                    "max_parallel": 4,
                    "max_wall_clock_seconds": 900,
                    "allow_remote_publish": False,
                    "disabled_optional_node_ids": [],
                },
            },
        )
        _require(run["status"] == "completed", "workflow did not complete")
        output_revision_id = run["output_revision_id"]
        _require(bool(output_revision_id), "workflow did not create an output revision")

        run_detail = request(
            client,
            "GET",
            f"/api/v1/runs/{run['id']}",
            label="get-run",
        )
        _require(len(run_detail["events"]) > 0, "workflow did not persist runtime events")

        image = request(
            client,
            "POST",
            "/api/v1/images/generate",
            label="generate-image",
            expected_status=201,
            json_body={
                "prompt": (
                    "为多平台智能发布文章生成一张简洁、克制、无品牌标识的横版封面，"
                    "表现 Markdown 内容流向三个发布平台。"
                ),
                "size": "1024x1024",
                "model": IMAGE_MODEL,
            },
        )
        _require(image["mocked"] is False, "image generation unexpectedly used a mock provider")
        _require(len(image["artifacts"]) == 1, "image generation did not persist one artifact")
        image_artifact_id = image["artifacts"][0]["id"]

        plan = request(
            client,
            "POST",
            "/api/v1/publish/plans",
            label="create-publish-plan",
            expected_status=201,
            json_body={
                "revision_id": output_revision_id,
                "selected_asset_ids": [image_artifact_id],
                "targets": [
                    {"platform": "wechat", "account_ref": "dry-run-wechat"},
                    {"platform": "csdn", "account_ref": "dry-run-csdn"},
                    {"platform": "toutiao", "account_ref": "dry-run-toutiao"},
                ],
            },
        )
        _require(len(plan["variants"]) == 3, "three platform variants were not created")
        plan_id = plan["plan"]["id"]

        request(
            client,
            "POST",
            f"/api/v1/publish/plans/{plan_id}/approve",
            label="approve-publish-plan",
            json_body={
                "actor_id": "user:real-api-e2e",
                "comment": "approved for local dry-run only",
            },
        )
        enqueued = request(
            client,
            "POST",
            f"/api/v1/publish/plans/{plan_id}/enqueue",
            label="enqueue-publish-plan",
        )
        _require(len(enqueued["jobs"]) == 3, "three publish jobs were not enqueued")

        receipts = []
        for index, job in enumerate(enqueued["jobs"], start=1):
            processed = request(
                client,
                "POST",
                f"/api/v1/publish/jobs/{job['id']}/process",
                label=f"process-publish-job-{index}",
            )
            _require(
                processed["job"]["state"] == "succeeded",
                f"publish job {index} did not succeed",
            )
            receipt = processed["receipt"]
            _require(receipt is not None, f"publish job {index} has no receipt")
            _require(
                receipt["remote_url"] is None,
                f"publish job {index} unexpectedly has a remote URL",
            )
            receipts.append(receipt)

        refreshed_plan = request(
            client,
            "GET",
            f"/api/v1/publish/plans/{plan_id}",
            label="get-completed-publish-plan",
        )
        _require(
            refreshed_plan["plan"]["status"] == "completed",
            "publish plan did not complete",
        )
        _require(
            all(job["state"] == "succeeded" for job in refreshed_plan["jobs"]),
            "not all publish jobs succeeded",
        )

        persisted = {
            "run_id": run["id"],
            "plan_id": plan_id,
            "image_artifact_id": image_artifact_id,
            "job_ids": [job["id"] for job in enqueued["jobs"]],
            "receipt_ids": [receipt["id"] for receipt in receipts],
            "output_revision_id": output_revision_id,
            "event_count": len(run_detail["events"]),
            "text_call_count": progress_provider.call_count,
            "text_model": model["model"],
            "image_model": image["model"],
            "image_media_type": image["artifacts"][0]["media_type"],
        }

    reopened = Database(f"sqlite:///{database_path.as_posix()}")
    try:
        with reopened.session() as session:
            repository = SqlAlchemyRuntimeRepository(session)
            durable_run = repository.get_run(persisted["run_id"])
            durable_plan = repository.get_publish_plan(persisted["plan_id"])
            durable_image = repository.get_artifact(persisted["image_artifact_id"])
            durable_jobs = [
                repository.get_publish_job(job_id) for job_id in persisted["job_ids"]
            ]
            _require(
                durable_run is not None and durable_run.status is RunStatus.COMPLETED,
                "workflow was not durable after SQLite reopen",
            )
            _require(durable_plan is not None, "publish plan was not durable after SQLite reopen")
            _require(
                durable_image is not None,
                "image artifact was not durable after SQLite reopen",
            )
            _require(
                all(
                    job is not None and job.state is PublishJobState.SUCCEEDED
                    for job in durable_jobs
                ),
                "publish jobs were not durable after SQLite reopen",
            )
            _require(
                all(
                    job is not None
                    and repository.get_publish_receipt_for_job(job.id) is not None
                    for job in durable_jobs
                ),
                "publish receipts were not durable after SQLite reopen",
            )
    finally:
        reopened.dispose()

    report = {
        "schema_version": "open-publisher.real-api-e2e.v1",
        "result": "passed",
        "api_steps": steps,
        "models": {
            "text": persisted["text_model"],
            "text_calls": persisted["text_call_count"],
            "image": persisted["image_model"],
            "image_media_type": persisted["image_media_type"],
            "mocked": False,
        },
        "workflow": {
            "status": "completed",
            "event_count": persisted["event_count"],
            "output_revision_persisted": True,
        },
        "publishing": {
            "mode": "dry_run",
            "platforms": ["wechat", "csdn", "toutiao"],
            "variant_count": 3,
            "job_count": 3,
            "receipt_count": 3,
            "remote_platform_write_performed": False,
        },
        "durability": {
            "sqlite_reopened": True,
            "workflow": True,
            "image_artifact": True,
            "jobs_and_receipts": True,
        },
        "elapsed_seconds": round(monotonic() - started, 3),
    }
    report_path = output_dir / "report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {**report, "output_dir": str(output_dir), "report_path": str(report_path)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the real model, image, and dry-run publishing flow through FastAPI."
    )
    parser.add_argument(
        "--confirm-external-model-calls",
        action="store_true",
        help="Required opt-in. Test prompts will be sent to the configured model provider.",
    )
    parser.add_argument("--output-dir", type=Path, default=None)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.confirm_external_model_calls:
        raise SystemExit("refusing external model calls without explicit confirmation")
    report = run_real_api_e2e(output_dir=args.output_dir or _default_output_dir())
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
