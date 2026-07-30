# Local v0.1 demo

This demo exercises the complete local boundary with deterministic providers. It does not publish
to a real account.

## Bootstrap

From the repository root in PowerShell:

```powershell
.\scripts\bootstrap.ps1
```

The script installs workspace dependencies and creates the development virtual environment. The
first run needs network access for packages; ordinary demo runs do not.

## Desktop demo

Run the Tauri application:

```powershell
pnpm dev
```

In development, Rust starts the Python runtime on a random loopback port with a per-launch bearer
token. Neither value is returned to the WebView. Use the top-bar **运行工作流** action to run the
deterministic article workflow. Rust resolves the desktop article to its durable backend revision,
selects the current workflow, starts a run, and returns the output Markdown plus a bounded Artifact
summary. The private Sidecar endpoint, bearer token, Artifact bytes, and secret references never
cross into the WebView.

The **发布** page exercises the granular local path rather than the convenience demo endpoint:
create platform variants, inspect them, explicitly approve the bound hashes, enqueue the same plan
twice to verify idempotency, process each deterministic dry-run job, and reload the resulting
SQLite receipts. None of those actions contacts WeChat, CSDN, or Toutiao. The **生成配图** command
also crosses the Rust boundary and stores validated bytes in the local Artifact Store, while the
WebView receives only provider/model/count/media-type metadata.

Article catalog metadata, evidence cards, and the general task catalog still contain seeded product
examples in v0.1. Model connection forms persist only public configuration and a broker reference;
the default desktop workflow continues to use the built-in deterministic Mock until the Rust
credential-lease activation path is implemented.

For UI-only work, run:

```powershell
pnpm dev:web
```

The browser build deliberately uses the interface-only bridge; it cannot reach the Python API.

## Sidecar-only demo

The runtime can also be started directly for backend development:

```powershell
$env:OPEN_PUBLISHER_API_TOKEN = "replace-with-a-long-random-development-token"
.\.venv\Scripts\open-publisher-agent-runtime.exe
```

Every request, including `/health`, requires `Authorization: Bearer <token>`. This prevents an
unrelated local process from probing or driving the Sidecar.

To turn a `content_package` object returned by the demo/export API into a directory for Wandao,
save that object as UTF-8 JSON and run:

```powershell
.\.venv\Scripts\open-publisher-content-package.exe materialize .\package.json .\content-package
.\.venv\Scripts\open-publisher-content-package.exe verify .\content-package
```

The destination must not already exist. Materialization validates every path, Base64 payload, size,
and hash before creating the final directory.

## Verify

Run every available basic check:

```powershell
.\.venv\Scripts\python .\scripts\quality_check.py
```

Live WeChat, CSDN, and Toutiao tests are intentionally excluded. See
[`platform-capabilities.md`](../integrations/platform-capabilities.md) for the exact boundary.

## Explicit real-model E2E

The real integration command calls SiliconFlow for text and one generated image, then exercises
the same local Harness, approval binding, platform variants, idempotent outbox, dry-run receipts,
SQLite reopen, and ContentPackage materialize/verify path. It never writes to a content platform.
The API key is accepted only through the current process environment and is not included in the
result report:

```powershell
$env:OPEN_PUBLISHER_SILICONFLOW_API_KEY = "<temporary key>"
.\services\agent-runtime\.venv\Scripts\open-publisher-real-e2e.exe `
  --confirm-external-model-calls
Remove-Item Env:OPEN_PUBLISHER_SILICONFLOW_API_KEY
```

Outputs are written under `.local/real-e2e/` by default. Each run contains an isolated SQLite
database, content-addressed Artifact Store, verified ContentPackage directory, and a sanitized
`report.json`. This command is deliberately excluded from ordinary unit tests and quality checks.
