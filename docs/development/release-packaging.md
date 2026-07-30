# Desktop release packaging boundary

Open Publisher v0.1 P0 supports the Tauri desktop application from a clean development checkout.
It does **not** produce a self-contained or distributable installer.

## Why release bundles are blocked

The Rust supervisor currently launches the Python module from `services/agent-runtime` and resolves
either a development virtual environment, `OPEN_PUBLISHER_PYTHON`, or `python` on `PATH`. Tauri does
not bundle the Python interpreter, runtime dependencies, or service source. A normal `tauri build`
can therefore produce a small UI-shell installer that works on the build checkout but cannot start
the Sidecar on another machine.

`beforeBuildCommand` runs `scripts/check_desktop_bundle.mjs` and fails before release compilation so
this incomplete artifact is not mistaken for an installable product.

For local bundle-layout inspection only, a developer can acknowledge the limitation explicitly:

```powershell
$env:OPEN_PUBLISHER_ALLOW_DEV_SHELL_BUNDLE = "1"
pnpm --filter @open-publisher/desktop tauri:build -- --bundles nsis
Remove-Item Env:OPEN_PUBLISHER_ALLOW_DEV_SHELL_BUNDLE
```

The result is an unsigned development shell and must not be distributed.

## Release exit criteria

A future installer may remove the guard only after it has:

- built a target-specific, versioned Python Sidecar artifact with locked dependencies;
- declared that artifact as a Tauri external binary or reviewed bundle resource;
- resolved the packaged executable at runtime without a source checkout or system Python;
- passed a post-install Sidecar health and deterministic workflow smoke test on a clean machine;
- verified child-process termination, upgrade/uninstall behavior, signing, and artifact provenance.

Windows, macOS, and Linux Sidecars must be built and tested on their target operating systems.
