# Read Client / Agent package.json versions (no hardcoded numbers).
# Usage:
#   .\scripts\get-version.ps1
#   .\scripts\get-version.ps1 -WorkspaceRoot D:\Project
# Output (stdout): JSON { "clientVersion":"…", "agentVersion":"…" }

param(
  [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

if (-not $WorkspaceRoot) {
  # scripts/ → repo root
  $WorkspaceRoot = Split-Path -Parent $PSScriptRoot
  if (-not (Test-Path (Join-Path $WorkspaceRoot "mjh-printer-client"))) {
    $WorkspaceRoot = $PSScriptRoot
  }
}

$clientPkgPath = Join-Path $WorkspaceRoot "mjh-printer-client\package.json"
$agentPkgPath = Join-Path $WorkspaceRoot "mjh-printer-agent\package.json"

if (-not (Test-Path -LiteralPath $clientPkgPath)) {
  throw "Client package.json not found: $clientPkgPath"
}
if (-not (Test-Path -LiteralPath $agentPkgPath)) {
  throw "Agent package.json not found: $agentPkgPath"
}

$clientPkg = Get-Content -LiteralPath $clientPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$agentPkg = Get-Content -LiteralPath $agentPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

$clientVersion = [string]$clientPkg.version
$agentVersion = [string]$agentPkg.version

if (-not $clientVersion) { throw "mjh-printer-client/package.json missing version" }
if (-not $agentVersion) { throw "mjh-printer-agent/package.json missing version" }

$result = [ordered]@{
  clientVersion = $clientVersion
  agentVersion  = $agentVersion
}

$json = ($result | ConvertTo-Json -Compress)
Write-Output $json
