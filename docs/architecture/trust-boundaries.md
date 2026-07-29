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
with a per-launch token and terminates the complete process tree when the desktop application
exits.

## Credential path

```text
ConnectionProfile.secret_ref
  -> Rust secret broker
  -> short-lived credential lease
  -> one provider or publisher operation
  -> lease disposal
```

Secrets are absent from SQLite rows, workflow definitions, checkpoints, browser-extension tasks,
logs, and exported diagnostics.

## Publishing path

Agents produce content artifacts only. A publish request becomes an immutable `PublishPlan`, then
a durable `PublishJob`. The deterministic publisher claims the job, validates its approval grant,
performs one remote operation, and reconciles the result.

Browser-session publishers receive article payloads and scoped task identifiers. They never send
cookies or local storage back to the desktop application.

