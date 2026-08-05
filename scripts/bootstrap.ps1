$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

foreach ($Program in @("node", "pnpm", "cargo", "bun")) {
    if (-not (Get-Command $Program -ErrorAction SilentlyContinue)) {
        throw "Missing required development program: $Program"
    }
}

pnpm install

Write-Output "Development environment is ready. Run 'pnpm dev' for the desktop app or 'pnpm quality' for local checks."
