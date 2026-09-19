# Build MJH-Printer-Setup.exe
#
# Prerequisites:
# - Agent: pnpm build:exe in mjh-printer-agent
# - Client: pnpm dist:win in mjh-printer-client (electron-builder)
# - Inno Setup 6: ISCC.exe on PATH or at default install path

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Client = Join-Path $Root "mjh-printer-client"
$AgentRelease = Join-Path $Root "mjh-printer-agent\release"
$OutDir = Join-Path $Root "dist-installer"

Write-Host "=== MJH Printer Setup build ==="

if (-not (Test-Path (Join-Path $AgentRelease "MJH-Printer-Agent.exe"))) {
  throw "Missing Agent EXE. Run: cd mjh-printer-agent; pnpm build:exe"
}
if (-not (Test-Path (Join-Path $Client "release\win-unpacked"))) {
  throw "Missing Client win-unpacked. Run: cd mjh-printer-client; pnpm dist:win"
}

$iscc = $null
foreach ($c in @(
  "ISCC.exe",
  "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
  "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
)) {
  if (Get-Command $c -ErrorAction SilentlyContinue) { $iscc = (Get-Command $c).Source; break }
  if (Test-Path $c) { $iscc = $c; break }
}
if (-not $iscc) {
  throw "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
& $iscc (Join-Path $Client "installer\setup.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed" }

$setup = Join-Path $OutDir "MJH-Printer-Setup.exe"
if (-not (Test-Path $setup)) { throw "Setup EXE not produced" }
Write-Host "OK: $setup"
Get-Item $setup | Format-List FullName, Length, LastWriteTime
