# Build MJH Printer Setup.exe + copy Client.exe into dist/
#
# Prerequisites:
# - Agent: pnpm build:exe in mjh-printer-agent
# - Client: pnpm dist:win in mjh-printer-client
# - Inno Setup 6: ISCC.exe

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Client = Join-Path $Root "mjh-printer-client"
$AgentRelease = Join-Path $Root "mjh-printer-agent\release"
$DistDir = Join-Path $Root "dist"
$Unpacked = Join-Path $DistDir "client-build\win-unpacked"

Write-Host "=== MJH Printer Setup build ==="

if (-not (Test-Path (Join-Path $AgentRelease "MJH-Printer-Agent.exe"))) {
  throw "Missing Agent EXE. Run: cd mjh-printer-agent; pnpm build:exe"
}
if (-not (Test-Path $Unpacked)) {
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

New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# Standalone Client.exe for dist/
$clientSrc = Join-Path $Unpacked "MJH Printer Client.exe"
$clientDst = Join-Path $DistDir "MJH Printer Client.exe"
if (-not (Test-Path $clientSrc)) { throw "Missing $clientSrc" }
Copy-Item -Force $clientSrc $clientDst
Write-Host "Copied Client → $clientDst"

& $iscc (Join-Path $Client "installer\setup.iss")
if ($LASTEXITCODE -ne 0) { throw "ISCC failed" }

$setup = Join-Path $DistDir "MJH Printer Setup.exe"
if (-not (Test-Path $setup)) { throw "Setup EXE not produced at $setup" }
Write-Host "OK: $setup"
Write-Host "OK: $clientDst"
Get-Item $setup, $clientDst | Format-List FullName, Length, LastWriteTime
