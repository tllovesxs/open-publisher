const acknowledgement = "OPEN_PUBLISHER_ALLOW_DEV_SHELL_BUNDLE";

if (process.env[acknowledgement] !== "1") {
  console.error(
    [
      "Desktop bundle blocked by the v0.1 release boundary.",
      "The Python runtime, its dependencies, and its source are not bundled yet.",
      "A generated installer would open the UI but fail to start the sidecar on another machine.",
      `Set ${acknowledgement}=1 only to inspect an explicitly incomplete development shell bundle.`,
      "See docs/development/release-packaging.md.",
    ].join("\n"),
  );
  process.exitCode = 1;
} else {
  console.warn(
    [
      "Building an incomplete v0.1 development shell bundle.",
      "Do not distribute this artifact: it depends on the source checkout and a compatible Python environment.",
    ].join("\n"),
  );
}
