from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RUNTIME_VENV = ROOT / "services" / "agent-runtime" / ".venv"
PYTHON = next(
    (
        str(candidate)
        for candidate in (
            RUNTIME_VENV / "Scripts" / "python.exe",
            RUNTIME_VENV / "bin" / "python",
        )
        if candidate.is_file()
    ),
    sys.executable,
)


@dataclass(frozen=True)
class Check:
    name: str
    command: tuple[str, ...]
    required_program: str


CHECKS = (
    Check("TypeScript checks", ("pnpm", "check"), "pnpm"),
    Check("TypeScript tests", ("pnpm", "test"), "pnpm"),
    Check("Web builds", ("pnpm", "build"), "pnpm"),
    Check("Python lint", (PYTHON, "-m", "ruff", "check", "."), PYTHON),
    Check("Python tests", (PYTHON, "-m", "pytest"), PYTHON),
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
    Check(
        "Development Sidecar smoke",
        (
            "cargo",
            "test",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "supervisor::tests::development_sidecar_round_trip",
            "--",
            "--ignored",
            "--exact",
        ),
        "cargo",
    ),
    Check(
        "Rust clippy",
        (
            "cargo",
            "clippy",
            "--manifest-path",
            "apps/desktop/src-tauri/Cargo.toml",
            "--all-targets",
            "--all-features",
            "--",
            "-D",
            "warnings",
        ),
        "cargo",
    ),
)


def resolve_program(program: str) -> str | None:
    if Path(program).is_file():
        return str(Path(program))
    return shutil.which(program)


def main() -> int:
    failures: list[str] = []

    for check in CHECKS:
        executable = resolve_program(check.required_program)
        if executable is None:
            print(f"[skip] {check.name}: missing {check.required_program}")
            continue

        print(f"[run] {check.name}")
        command = check.command
        if command[0] == check.required_program:
            command = (executable, *command[1:])
        try:
            result = subprocess.run(command, cwd=ROOT, check=False)
        except OSError as error:
            print(f"[fail] {check.name}: could not start {executable}: {error}")
            failures.append(check.name)
            continue
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
