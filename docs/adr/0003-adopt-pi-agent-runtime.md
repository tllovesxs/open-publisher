# ADR 0003: Adopt Pi Agent TypeScript Runtime

- Status: Accepted
- Date: 2026-08-04
- Supersedes: the Runtime choice in ADR 0001

## Context

The first implementation used a Python FastAPI/LangGraph Sidecar. It proved the product flow but
also duplicated model loops, streaming, tool execution, cancellation, sessions, and recovery logic
that a mature agent runtime already provides. Packaging Python also increased the desktop release
surface and kept the React product, Rust host, and Agent Runtime in three implementation languages.

The project must preserve existing articles, templates, assets, prompts, publishing records,
browser-extension work, and the deterministic publication boundary. A runtime change must not
become a full product rewrite or grant an Agent arbitrary local or publishing authority.

## Decision

Replace the Python/FastAPI/LangGraph Runtime with a TypeScript Sidecar built around:

- `@earendil-works/pi-agent-core` for the model/tool loop, streaming events, cancellation, steering,
  sessions, and compaction;
- `@earendil-works/pi-ai` for model-provider integration;
- Hono for the authenticated loopback API;
- SQLite and Drizzle for local business persistence;
- Markdown files plus immutable revisions as the canonical article store;
- a Bun-compiled external binary for desktop distribution.

The Pi packages are pinned behind `PiAgentAdapter`. Product code does not depend directly on Pi
event shapes outside this adapter. Pi's TUI, Bash tool, arbitrary filesystem tools, and default
coding-agent prompt are not part of the product.

Keep React as the presentation layer and Rust as the operating-system, process, scope, and secret
boundary. Keep deterministic publishing, human approval, Outbox, Attempt, Receipt, and the browser
extension outside Agent authority.

During migration, a development-only engine switch may select Python or Pi for one complete user
operation. There is no dual write. Python is removed after storage parity, Agent parity, real-model
tests, deterministic publishing tests, and a clean Windows package test pass.

## Consequences

- The desktop product and Agent Runtime share TypeScript types and tooling.
- The release artifact no longer requires a Python installation after cutover.
- Pi API churn is isolated in one adapter and controlled by exact dependency versions.
- Existing Python workflow events and database rows remain readable migration history.
- Provider streams are not magically resumable after a crash; recovery starts from durable
  Markdown checkpoints, tool results, or committed revisions.
- Runtime migration work must include database backup, repeatable migration, protocol v2, and
  explicit rollback evidence before Python deletion.

## Execution specification

The normative migration and acceptance details are defined in
`docs/architecture/pi-agent-runtime-migration.md`.
