# Open Publisher Agent Runtime

Python 3.12/3.13 sidecar for Open Publisher. It owns AI orchestration and local business
state while deliberately exposing only a deterministic dry-run publisher in this first
version.

## Development

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev,langgraph]"
.\.venv\Scripts\python -m pytest
.\.venv\Scripts\python -m ruff check .
$env:OPEN_PUBLISHER_API_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(32))"
.\.venv\Scripts\open-publisher-agent-runtime
```

The default data directory is `.local/agent-runtime`. Override it with
`OPEN_PUBLISHER_DATA_DIR`. Database connections use SQLite WAL mode. Every request must send
`Authorization: Bearer $OPEN_PUBLISHER_API_TOKEN`; the Tauri host creates a new token for each
Sidecar launch. The runtime refuses non-loopback API hosts.

## API

- `GET /health`
- `GET /api/v1/version`
- `GET /api/v1/platforms/capabilities`
- `GET /api/v1/articles`
- `POST /api/v1/articles`
- `GET /api/v1/articles/{article_id}`
- `GET /api/v1/articles/{article_id}/revisions`
- `POST /api/v1/articles/{article_id}/revisions`
- `GET /api/v1/workflows`
- `POST /api/v1/runs`
- `GET /api/v1/runs/{run_id}`
- `GET /api/v1/runs/{run_id}/events`
- `POST /api/v1/runs/{run_id}/resume`
- `GET /api/v1/connections`
- `POST /api/v1/connections`
- `GET /api/v1/catalog`
- `POST /api/v1/images/generate`
- `POST /api/v1/publish/plans`
- `GET /api/v1/publish/plans/{plan_id}`
- `POST /api/v1/publish/plans/{plan_id}/approve`
- `POST /api/v1/publish/plans/{plan_id}/enqueue`
- `POST /api/v1/publish/jobs/{job_id}/process`
- `POST /api/v1/publish/jobs/{job_id}/reconcile`
- `POST /api/v1/content-packages/export`
- `POST /api/v1/content-packages/import`
- `POST /api/v1/demo/complete`

No endpoint performs a real platform write. `ConnectionProfile` persists an opaque
`secret_ref` only, while public API responses expose only its scheme and configured state.
Publish plans always begin pending and require the explicit, content-hash-bound approval command
before enqueue.

The P0 LangGraph preset has seven model-backed nodes: research, outline, draft, natural-style,
review, risk, and visual planning. Review, risk, and visual planning fan out with a policy-bound
`max_parallel` limit. Platform variants are deterministic Markdown transformations tagged
`deterministic-platform-transform.v1`; they are not model-backed agents in v0.1 and cannot publish.

Artifact rows represent logical production events and keep their own kind and lineage metadata.
Rows may share a SHA-256 and storage path; the filesystem deduplicates the immutable Blob bytes.

`GET /api/v1/platforms/capabilities` is a deterministic, static/offline inventory for
微信公众号、CSDN and 今日头条. It does not inspect saved connections, read credentials,
probe a network, create a browser task, select a fallback route, or publish content.

`POST /api/v1/images/generate` validates all Base64 image bytes before storing any Artifact.
Provider-returned URLs are counted but never downloaded by the Sidecar. The default provider emits
a deterministic SVG; a real OpenAI-compatible provider must be wired through the trusted host.

The separate `open-publisher-content-package` command materializes transfer JSON into a bounded
portable directory and verifies its manifest plus every declared file hash:

```powershell
open-publisher-content-package materialize package.json content-package
open-publisher-content-package verify content-package
```
