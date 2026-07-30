# Trust boundaries

## Desktop request path

```text
React WebView
  -> Tauri IPC command
  -> Rust validation and authorization
  -> authenticated local Sidecar request
  -> Python application use case
  -> structured response or event
```

The WebView does not call the Sidecar directly. Rust starts the Sidecar on a random loopback port
with a per-launch token and terminates the supervised child when the desktop application exits.
The P0 Sidecar runs Uvicorn with reload disabled and is expected to remain a single process.
Operating-system process-tree containment is release-hardening work, not a current guarantee.

## Credential path

The intended production path is:

```text
ConnectionProfile.secret_ref
  -> Rust secret broker
  -> short-lived credential lease
  -> one provider or publisher operation
  -> lease disposal
```

The v0.1 desktop implements the public configuration boundary but not the production broker:
it stores only an `env://VARIABLE_NAME` or `mock://` reference, never the environment value.
The deterministic demo stays on Mock and does not activate saved real-provider profiles. A
developer who later wires the standalone Python provider to `env://` must understand that the
Sidecar process can then read that environment value; this is a development bridge, not the
planned short-lived Rust lease.

Plaintext secrets are absent from SQLite rows, workflow definitions, checkpoints,
browser-extension tasks, logs, and exported diagnostics. Secret *references* may be stored in a
connection profile.

## Publishing path

Agents produce content artifacts only. A publish request becomes an immutable `PublishPlan`, then
a durable `PublishJob`. The deterministic publisher claims the job, validates its approval grant,
performs one remote operation, and reconciles the result.

Browser-session publishers receive article payloads and scoped task identifiers. They never send
cookies or local storage back to the desktop application. In v0.1 this is a protocol boundary, not
an active desktop-to-extension channel: only the extension's own popup can submit the local smoke
task to its Service Worker.
