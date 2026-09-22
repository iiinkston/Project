# Pre-release version consistency gate for OTA CI.
# Fails if Client/Agent package.json versions do not match embedded builder fields
# or if the git tag (when present) is malformed.
#
# Usage:
#   .\scripts\validate-release-versions.ps1
#   .\scripts\validate-release-versions.ps1 -WorkspaceRoot D:\Project -Tag v1.0.8

param(
  [string]$WorkspaceRoot = "",
  [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

if (-not $WorkspaceRoot) {
  $WorkspaceRoot = Split-Path -Parent $PSScriptRoot
}

function Fail([string]$msg) {
  Write-Error "VERSION_GATE_FAIL: $msg"
  exit 1
}

function Assert-Semver([string]$label, [string]$ver) {
  if (-not $ver) { Fail "$label is empty" }
  if ($ver -notmatch '^\d+\.\d+\.\d+$') {
    Fail "$label='$ver' must be numeric semver X.Y.Z (no -test / -ga suffix)"
  }
}

$clientPkgPath = Join-Path $WorkspaceRoot "mjh-printer-client\package.json"
$agentPkgPath = Join-Path $WorkspaceRoot "mjh-printer-agent\package.json"

if (-not (Test-Path -LiteralPath $clientPkgPath)) { Fail "missing $clientPkgPath" }
if (-not (Test-Path -LiteralPath $agentPkgPath)) { Fail "missing $agentPkgPath" }

$clientPkg = Get-Content -LiteralPath $clientPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$agentPkg = Get-Content -LiteralPath $agentPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

$clientVersion = [string]$clientPkg.version
$agentVersion = [string]$agentPkg.version
Assert-Semver "mjh-printer-client/package.json version" $clientVersion
Assert-Semver "mjh-printer-agent/package.json version" $agentVersion

# electron-builder overrides must not drift from package.json
$build = $clientPkg.build
if ($null -ne $build) {
  if ($null -ne $build.buildVersion -and [string]$build.buildVersion -ne "" -and [string]$build.buildVersion -ne $clientVersion) {
    Fail "Client build.buildVersion='$($build.buildVersion)' != package.json version='$clientVersion'. Remove override or sync."
  }
  if ($null -ne $build.extraMetadata -and $null -ne $build.extraMetadata.version) {
    $em = [string]$build.extraMetadata.version
    if ($em -ne "" -and $em -ne $clientVersion) {
      Fail "Client build.extraMetadata.version='$em' != package.json version='$clientVersion'. Remove override or sync."
    }
  }
}

# Optional: tag hygiene (tag is release channel label; need not equal agent version)
if ($Tag) {
  if ($Tag -notmatch '^v') {
    Fail "Tag '$Tag' must start with 'v'"
  }
  if ($Tag -match '(?i)test') {
    Fail "Tag '$Tag' looks like a test tag — refuse production OTA Release workflow"
  }
}

Write-Host "VERSION_GATE_OK client=$clientVersion agent=$agentVersion tag=$Tag"
@{
  clientVersion = $clientVersion
  agentVersion  = $agentVersion
  tag           = $Tag
} | ConvertTo-Json -Compress
