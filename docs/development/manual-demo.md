# Local v0.1 demo

This demo exercises the complete local boundary with deterministic providers. It does not publish
to a real account.

## Bootstrap

From the repository root in PowerShell:

```powershell
.\scripts\bootstrap.ps1
```

The script installs workspace dependencies. The first run needs network access for packages;
ordinary demo runs do not.

## Desktop demo

Run the Tauri application:

```powershell
pnpm dev
```

In development, Rust starts the Pi runtime on a random loopback port with a per-launch bearer
token. Neither value is returned to the WebView. Use the top-bar **运行工作流** action to run the
deterministic article workflow. Rust resolves the desktop article to its durable backend revision,
selects the current workflow, starts a run, and returns the output Markdown plus a bounded Artifact
summary. The private Sidecar endpoint, bearer token, Artifact bytes, and secret references never
cross into the WebView.

The **发布** page exercises the granular local dry-run path: create platform variants, inspect
them, explicitly approve the bound hashes, enqueue the same plan twice to verify idempotency,
process each deterministic job, and reload the resulting SQLite receipts. None of those actions
contacts WeChat, CSDN, or Toutiao. On an article page, the separate **发布** action may instead
request the already-connected WechatSync local bridge to save selected, logged-in platforms as
drafts. That action requires explicit confirmation and is not part of automated testing; it never
clicks a final platform publish control. The **生成配图** command also crosses the Rust boundary and
stores validated bytes in the local Artifact Store, while the WebView receives only
provider/model/count/media-type metadata.

Article catalog metadata, evidence cards, and the general task catalog still contain seeded product
examples in v0.1. Model connection forms persist only public configuration and a broker reference;
the default desktop workflow continues to use the built-in deterministic Mock until the Rust
credential-lease activation path is implemented.

For UI-only work, run:

```powershell
pnpm dev:web
```

The browser build deliberately uses the interface-only bridge; it cannot reach the Pi API.

## Sidecar-only demo

The runtime can also be started directly for backend development:

```powershell
$env:OPEN_PUBLISHER_API_TOKEN = "replace-with-a-long-random-development-token"
bun .\services\agent-runtime\src\main.ts
```

Every request, including `/health`, requires `Authorization: Bearer <token>`. This prevents an
unrelated local process from probing or driving the Sidecar.

ContentPackage materialization is performed by the Rust desktop boundary. The destination must not
already exist; materialization validates every path, Base64 payload, size and hash before creating
the final directory.

## Verify

Run every available basic check:

```powershell
pnpm quality
```

Live WeChat, CSDN, and Toutiao tests are intentionally excluded. See
[`platform-capabilities.md`](../integrations/platform-capabilities.md) for the exact boundary.

## Explicit real-model E2E

The Pi Runtime's opt-in real integration suite calls a configured provider for text and one image,
then exercises the same local Harness, approval binding, platform variants, idempotent outbox,
SQLite reopen, and ContentPackage path. It never writes to a content platform. The API key is
accepted only through the current process environment and is not included in the result report:

```powershell
$env:OPEN_PUBLISHER_REAL_MODEL_KEY = "<temporary key>"
pnpm --filter @open-publisher/agent-runtime test:real
Remove-Item Env:OPEN_PUBLISHER_REAL_MODEL_KEY
```

Outputs are written under `.local/real-e2e/` by default. Each run contains an isolated SQLite
database, content-addressed Artifact Store, verified ContentPackage directory, and a sanitized
`report.json`. This command is deliberately excluded from ordinary unit tests and quality checks.
