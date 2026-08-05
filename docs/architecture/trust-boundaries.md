# Trust boundaries

## Desktop request path

```text
React WebView
  -> Tauri IPC command
  -> Rust validation and authorization
  -> authenticated local Sidecar request
  -> Pi Runtime application use case
  -> structured response or event
```

The WebView does not call the Sidecar directly. Rust starts the Sidecar on a random loopback port
with a per-launch token and terminates the supervised child when the desktop application exits.
The Pi Sidecar runs as one Bun-compiled Hono process and is expected to remain a single process.
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

The desktop uses Rust DPAPI storage for model keys and grants the Pi Runtime a short-lived lease for
the requested provider operation. The WebView never reads the plaintext key. Environment variables
may be used only for an explicit development test and are not stored as connection configuration.

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
