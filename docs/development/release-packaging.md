# Desktop release packaging boundary

Open Publisher packages a Tauri desktop application with a target-specific Bun-compiled Pi runtime
sidecar. It does not require a separately installed Python interpreter.

## Sidecar packaging boundary

`beforeBuildCommand` builds `services/agent-runtime/src/main.ts` with Bun and stages the resulting
target-specific `open-publisher-agent-runtime` executable as a Tauri `externalBin`. Rust launches
that executable directly, so a release artifact contains the runtime and its locked dependency
graph rather than resolving a source checkout or a system runtime.

`scripts/check_desktop_bundle.mjs` verifies that the staged sidecar exists, is plausibly complete,
matches the host target and is listed in `bundle.externalBin`. It fails before release compilation
when those invariants are not met.

Build on the target operating system. Cross-compiling the Pi sidecar is deliberately rejected until
the dependency and signing process for each target is reviewed.

## Release exit criteria

A distributable installer requires all of the following:

- built a target-specific, versioned Pi Sidecar artifact with locked dependencies;
- declared that artifact as a Tauri external binary;
- resolved the packaged executable at runtime without a source checkout or system runtime;
- passed a post-install Sidecar health and deterministic workflow smoke test on a clean machine;
- verified child-process termination, upgrade/uninstall behavior, signing, and artifact provenance.

Windows, macOS, and Linux Sidecars must be built and tested on their target operating systems.
