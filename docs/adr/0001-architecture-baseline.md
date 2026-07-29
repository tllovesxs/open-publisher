# ADR 0001: Local-first architecture baseline

- Status: Accepted
- Date: 2026-07-30

## Context

The product must combine intelligent long-form writing, visual asset generation, and reliable
multi-platform publishing without requiring a hosted service for the first release.

## Decision

Use a Tauri v2 desktop application with a React/TypeScript WebView, a Rust security host, and a
Python FastAPI/LangGraph Sidecar. The WebView talks only to Rust through Tauri IPC. Rust supervises
and authenticates the Sidecar.

Use Markdown revisions as canonical content. Research bundles, review reports, visual plans,
platform variants, publish plans, and receipts are immutable artifacts linked by hashes.

Keep model access in an in-process `ModelAccessLayer`. LiteLLM is an implementation detail, not a
network proxy. External OpenAI-compatible gateways remain optional user connections.

Only a deterministic `PublishService` may perform remote publishing. Every remote write passes
through a durable outbox with idempotency and reconciliation.

## Consequences

- The desktop application works without a public cloud.
- A closed computer cannot run local scheduled jobs.
- Platform capabilities differ and must be probed per account.
- Python packaging, signing, and sidecar supervision are first-class release work.
- Browser-session publishing remains on the user's computer even if a cloud runner is added later.

