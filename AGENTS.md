# Repository working rules

## Non-negotiable architecture rules

1. The React WebView never receives plaintext API keys, platform secrets, or browser cookies.
2. Rust is the local operating-system and secret boundary.
3. The TypeScript Runtime owns AI and business logic through a pinned Pi Agent adapter, but public
   publishing is only performed through the deterministic publish service.
4. Markdown `ArticleRevision` is canonical. HTML and platform payloads are derived variants.
5. Cross-language payloads are defined in versioned JSON Schema before implementation.
6. Workflow runs use immutable snapshots. Running jobs are never altered by editor changes.
7. External writes require an outbox job, idempotency key, attempt record, and reconciliation.
8. Agents and skills return structured artifacts. They cannot silently mutate canonical content.
9. Tests must not call real model or publishing APIs unless explicitly marked as real integration
   tests and enabled by the user.
10. Preserve user data and unrelated working-tree changes.

## Directory ownership

- `apps/desktop`: React UI and Tauri host.
- `services/agent-runtime`: TypeScript domain, Pi Agent adapter, tools, providers, storage, and API.
- `extensions/browser-publisher`: browser-side publishing runtime.
- `packages/contracts`: canonical schemas and generated types.
- `skills/official`: declarative first-party skills only.

## Verification floor

- TypeScript: type check and focused unit tests.
- TypeScript Runtime: strict type check plus focused Vitest and process-integration tests.
- Rust: `cargo fmt --check` and `cargo check`.
- No real remote publishing during the initial implementation phase.
