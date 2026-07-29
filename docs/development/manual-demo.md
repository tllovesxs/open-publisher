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
deterministic article workflow, then inspect the revision, artifacts, platform variants, jobs, and
receipts in the corresponding pages.

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
