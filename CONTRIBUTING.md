# Contributing

Open Publisher is contract-first. Changes that cross the desktop, Python runtime, browser
extension, or plugin boundary start with a versioned schema in `packages/contracts`.

## Local checks

```powershell
python scripts/quality_check.py
```

The initial quality floor is intentionally small:

- TypeScript type checking and focused tests.
- Python Ruff and focused Pytest tests.
- Rust formatting and `cargo check`.
- Schema validation and extension manifest checks.

Real model and publishing calls are not part of the default suite.

## Architecture changes

Add or update an ADR when a change affects:

- process or trust boundaries;
- canonical content ownership;
- secrets and permissions;
- workflow snapshot compatibility;
- publishing idempotency;
- plugin or skill execution;
- local versus cloud responsibilities.

## Pull requests

Keep changes scoped, preserve unrelated work, and include a short verification note. Adapter
changes should identify the platform capability being added and the fallback behavior when it is
not available.

