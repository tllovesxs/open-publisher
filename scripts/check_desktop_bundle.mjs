import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binaryName = "open-publisher-agent-runtime";

const defaultTargetTriple = () => {
  const result = spawnSync("rustc", ["-vV"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  const match = result.stdout?.match(/^host:\s*(\S+)\s*$/m);
  if (match) {
    return match[1];
  }

  const triples = {
    "win32:x64": "x86_64-pc-windows-msvc",
    "win32:arm64": "aarch64-pc-windows-msvc",
    "darwin:x64": "x86_64-apple-darwin",
    "darwin:arm64": "aarch64-apple-darwin",
    "linux:x64": "x86_64-unknown-linux-gnu",
    "linux:arm64": "aarch64-unknown-linux-gnu",
  };
  const fallback = triples[`${process.platform}:${process.arch}`];
  if (!fallback) {
    throw new Error(`Unsupported desktop build host: ${process.platform}/${process.arch}.`);
  }
  return fallback;
};

const targetTriple = process.env.OPEN_PUBLISHER_TAURI_TARGET
  || process.env.TAURI_ENV_TARGET_TRIPLE
  || process.env.CARGO_BUILD_TARGET
  || defaultTargetTriple();
const suffix = process.platform === "win32" ? ".exe" : "";
const stagedBinary = join(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "binaries",
  `${binaryName}-${targetTriple}${suffix}`,
);
const configPath = join(repositoryRoot, "apps", "desktop", "src-tauri", "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
const externalBin = config.bundle?.externalBin;

if (!Array.isArray(externalBin) || !externalBin.includes(`binaries/${binaryName}`)) {
  throw new Error(
    `Tauri bundle.externalBin must include binaries/${binaryName} so the Pi Agent Runtime is shipped with the installer.`,
  );
}

if (!existsSync(stagedBinary)) {
  throw new Error(`Pi Agent Runtime sidecar is missing: ${stagedBinary}`);
}

const runtimeSize = statSync(stagedBinary).size;
if (runtimeSize < 1024 * 1024) {
  throw new Error(`Pi Agent Runtime sidecar is unexpectedly small (${runtimeSize} bytes).`);
}

if (process.platform === "win32") {
  const header = readFileSync(stagedBinary).subarray(0, 2).toString("ascii");
  if (header !== "MZ") {
    throw new Error("Pi Agent Runtime sidecar is not a Windows executable.");
  }
}

console.log(
  `Desktop bundle preflight passed: ${binaryName}-${targetTriple}${suffix} (${Math.round(runtimeSize / 1024 / 1024)} MiB).`,
);
