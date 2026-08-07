import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeEntry = join(repositoryRoot, "services", "agent-runtime", "src", "main.ts");
const binariesDirectory = join(repositoryRoot, "apps", "desktop", "src-tauri", "binaries");
const binaryName = "open-publisher-agent-runtime";

const executableName = (name) => (process.platform === "win32" ? `${name}.exe` : name);

const canRun = (command) => {
  const result = spawnSync(command, ["--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  return !result.error && result.status === 0;
};

const resolveExecutablePath = (command) => {
  if (isAbsolute(command) || existsSync(command)) {
    return resolve(command);
  }

  const locator = process.platform === "win32" ? "where.exe" : "which";
  const located = spawnSync(locator, [command], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: "pipe",
    shell: false,
  });
  if (located.error || located.status !== 0) {
    return null;
  }

  const match = located.stdout
    ?.split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line && existsSync(line));
  return match ? resolve(match) : null;
};

const localBunCandidates = () => {
  const candidates = [
    join(repositoryRoot, "node_modules", ".bin", executableName("bun")),
    join(repositoryRoot, "node_modules", "bun", "bin", executableName("bun")),
  ];
  const pnpmDirectory = join(repositoryRoot, "node_modules", ".pnpm");
  if (existsSync(pnpmDirectory)) {
    for (const entry of readdirSync(pnpmDirectory, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("bun@")) {
        candidates.push(
          join(pnpmDirectory, entry.name, "node_modules", "bun", "bin", executableName("bun")),
        );
      }
      if (entry.isDirectory() && entry.name.startsWith("@oven+bun-")) {
        const packageVersionIndex = entry.name.lastIndexOf("@");
        const packageName = entry.name.slice(0, packageVersionIndex).replace("+", "/");
        candidates.push(
          join(
            pnpmDirectory,
            entry.name,
            "node_modules",
            packageName,
            "bin",
            executableName("bun"),
          ),
        );
      }
    }
  }
  return candidates;
};

const resolveBun = () => {
  for (const candidate of localBunCandidates()) {
    if (existsSync(candidate) && canRun(candidate)) {
      return candidate;
    }
  }

  for (const candidate of [process.env.OPEN_PUBLISHER_BUN, process.env.BUN_EXE, "bun"]) {
    if (candidate && canRun(candidate)) {
      const executablePath = resolveExecutablePath(candidate);
      if (executablePath) {
        return executablePath;
      }
    }
  }

  throw new Error(
    "Bun is required to compile the Pi Agent Runtime. Install workspace dependencies or set OPEN_PUBLISHER_BUN to a Bun executable.",
  );
};

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
const hostTriple = defaultTargetTriple();

if (targetTriple !== hostTriple) {
  throw new Error(
    `Pi Agent Runtime cross-compilation is not configured (${hostTriple} -> ${targetTriple}). Build the desktop bundle on the target platform or set OPEN_PUBLISHER_TAURI_TARGET to the host target.`,
  );
}

if (!existsSync(runtimeEntry)) {
  throw new Error(`Pi Agent Runtime entry point is missing: ${runtimeEntry}`);
}

const bun = resolveBun();
const stagedBinary = join(binariesDirectory, executableName(`${binaryName}-${targetTriple}`));
const temporaryBinary = join(binariesDirectory, executableName(`${binaryName}-${targetTriple}.build-${process.pid}`));
const windowsCompileExecutable = process.platform === "win32"
  ? join(tmpdir(), `open-publisher-bun-${process.pid}-${Date.now()}.exe`)
  : null;

mkdirSync(binariesDirectory, { recursive: true });
rmSync(temporaryBinary, { force: true });

// Bun 1.3.x can fail to self-copy during `--compile` when its installed path
// contains non-ASCII characters. A short temporary copy is both isolated per
// build and removed immediately after the compiler has consumed it.
const compileArguments = ["build", runtimeEntry, "--compile", "--minify"];
if (windowsCompileExecutable) {
  copyFileSync(bun, windowsCompileExecutable);
  compileArguments.push("--compile-executable-path", windowsCompileExecutable);
}
compileArguments.push("--outfile", temporaryBinary);

let compile;
try {
  compile = spawnSync(
    bun,
    compileArguments,
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: "inherit",
      shell: false,
    },
  );
} finally {
  if (windowsCompileExecutable) rmSync(windowsCompileExecutable, { force: true });
}

if (compile.error || compile.status !== 0 || !existsSync(temporaryBinary)) {
  rmSync(temporaryBinary, { force: true });
  throw new Error(
    [
      "Bun could not compile the Pi Agent Runtime.",
      `Bun executable: ${bun}`,
      "The existing staged runtime was left untouched.",
      "If Bun reports a temporary-file error, repair/reinstall the local Bun package and retry.",
    ].join("\n"),
  );
}

if (statSync(temporaryBinary).size < 1024 * 1024) {
  rmSync(temporaryBinary, { force: true });
  throw new Error("The compiled Pi Agent Runtime is unexpectedly small.");
}

// copyFile replaces the destination only after Bun has produced a complete temporary executable.
// This keeps a usable sidecar in place when compilation itself fails.
copyFileSync(temporaryBinary, stagedBinary);
rmSync(temporaryBinary, { force: true });
console.log(`Staged Pi Agent Runtime: ${basename(stagedBinary)}`);
