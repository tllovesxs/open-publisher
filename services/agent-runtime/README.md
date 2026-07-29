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
- `POST /api/v1/articles`
- `POST /api/v1/articles/{article_id}/revisions`
- `GET /api/v1/workflows`
- `POST /api/v1/runs`
- `POST /api/v1/runs/{run_id}/resume`
- `POST /api/v1/publish/plans`
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
