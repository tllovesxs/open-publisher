$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

foreach ($Program in @("node", "pnpm", "cargo", "python")) {
    if (-not (Get-Command $Program -ErrorAction SilentlyContinue)) {
        throw "Missing required development program: $Program"
    }
}

pnpm install

if (-not (Test-Path -LiteralPath ".venv")) {
    python -m venv .venv
}

$PythonExe = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
& $PythonExe -m pip install --upgrade pip
& $PythonExe -m pip install -e ".[dev]"
& $PythonExe -m pip install -e ".\services\agent-runtime[dev]"

Write-Output "Development environment is ready."

