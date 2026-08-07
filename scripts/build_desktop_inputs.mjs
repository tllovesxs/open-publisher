import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopDirectory = join(repositoryRoot, "apps", "desktop");
const viteEntry = join(desktopDirectory, "node_modules", "vite", "bin", "vite.js");

const runNode = (label, entry, arguments_ = [], cwd = repositoryRoot) => {
  if (!existsSync(entry)) {
    throw new Error(`${label} entry point is missing: ${entry}`);
  }
  const result = spawnSync(process.execPath, [entry, ...arguments_], {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
};

runNode("Pi Agent Runtime build", join(repositoryRoot, "scripts", "build_pi_runtime.mjs"));
runNode("Desktop bundle preflight", join(repositoryRoot, "scripts", "check_desktop_bundle.mjs"));
runNode("Desktop web build", viteEntry, ["build"], desktopDirectory);
