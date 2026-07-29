from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Check:
    name: str
    command: tuple[str, ...]
    required_program: str


CHECKS = (
    Check("TypeScript checks", ("pnpm", "check"), "pnpm"),
    Check("TypeScript tests", ("pnpm", "test"), "pnpm"),
    Check("Web builds", ("pnpm", "build"), "pnpm"),
    Check("Python lint", (sys.executable, "-m", "ruff", "check", "."), sys.executable),
    Check("Python tests", (sys.executable, "-m", "pytest"), sys.executable),
    Check(
        "Rust formatting",
        (
            "cargo",
            "fmt",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "--check",
        ),
        "cargo",
    ),
    Check(
        "Rust check",
        ("cargo", "check", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"),
        "cargo",
    ),
    Check(
        "Rust tests",
        ("cargo", "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml"),
        "cargo",
    ),
)


def program_exists(program: str) -> bool:
    if Path(program).is_file():
        return True
    return shutil.which(program) is not None


def main() -> int:
    failures: list[str] = []

    for check in CHECKS:
        if not program_exists(check.required_program):
            print(f"[skip] {check.name}: missing {check.required_program}")
            continue

        print(f"[run] {check.name}")
        result = subprocess.run(check.command, cwd=ROOT, check=False)
        if result.returncode != 0:
            failures.append(check.name)

    if failures:
        print("\nFailed checks:")
        for name in failures:
            print(f"- {name}")
        return 1

    print("\nAll available checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
