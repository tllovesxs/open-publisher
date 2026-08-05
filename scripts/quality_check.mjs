import { spawnSync } from "node:child_process";

const checks = [
  ["TypeScript checks", "pnpm", ["check"]],
  ["TypeScript tests", "pnpm", ["test"]],
  ["Desktop bundle inputs", "pnpm", ["desktop:bundle:preflight"]],
  ["Rust formatting", "cargo", ["fmt", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--check"]],
  ["Rust check", "cargo", ["check", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"]],
  ["Rust tests", "cargo", ["test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"]],
  ["Rust clippy", "cargo", ["clippy", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--all-targets", "--all-features", "--", "-D", "warnings"]],
];

const failures = [];
for (const [name, command, args] of checks) {
  console.log(`[run] ${name}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error || result.status !== 0) failures.push(name);
}

if (failures.length > 0) {
  console.error(`\nFailed checks:\n${failures.map((name) => `- ${name}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log("\nAll checks passed.");
}
