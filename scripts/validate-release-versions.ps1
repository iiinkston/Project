# Pre-release version consistency gate for OTA CI.
# - package.json Client/Agent: semver + electron-builder override drift checks (separate)
# - git tag (when present): must be vX.Y.Z; used as OTA metadata client.version source
#
# stdout: ONLY one JSON object (machine-readable)
# stderr: human diagnostics / warnings
#
# Usage:
#   .\scripts\validate-release-versions.ps1
#   .\scripts\validate-release-versions.ps1 -WorkspaceRoot D:\Project -Tag v1.0.9

param(
  [string]$WorkspaceRoot = "",
  [string]$Tag = ""
)

$ErrorActionPreference = "Stop"

if (-not $WorkspaceRoot) {
  $WorkspaceRoot = Split-Path -Parent $PSScriptRoot
}

function Fail([string]$msg) {
  [Console]::Error.WriteLine("VERSION_GATE_FAIL: $msg")
  exit 1
}

function Write-Diag([string]$msg) {
  [Console]::Error.WriteLine($msg)
}

function Assert-Semver([string]$label, [string]$ver) {
  if (-not $ver) { Fail "$label is empty" }
  if ($ver -notmatch '^\d+\.\d+\.\d+$') {
    Fail "$label='$ver' must be numeric semver X.Y.Z (no -test / -ga suffix)"
  }
}

function Read-JsonStdout([object]$raw) {
  $line = @($raw) | Where-Object { $_ -and ("$_").Trim().StartsWith("{") } | Select-Object -Last 1
  if (-not $line) { Fail "expected JSON on stdout from nested script" }
  return ($line | ConvertFrom-Json)
}

$clientPkgPath = Join-Path $WorkspaceRoot "mjh-printer-client\package.json"
$agentPkgPath = Join-Path $WorkspaceRoot "mjh-printer-agent\package.json"

if (-not (Test-Path -LiteralPath $clientPkgPath)) { Fail "missing $clientPkgPath" }
if (-not (Test-Path -LiteralPath $agentPkgPath)) { Fail "missing $agentPkgPath" }

$clientPkg = Get-Content -LiteralPath $clientPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$agentPkg = Get-Content -LiteralPath $agentPkgPath -Raw -Encoding UTF8 | ConvertFrom-Json

$packageClientVersion = [string]$clientPkg.version
$agentVersion = [string]$agentPkg.version
Assert-Semver "mjh-printer-client/package.json version" $packageClientVersion
Assert-Semver "mjh-printer-agent/package.json version" $agentVersion

# electron-builder overrides must not drift from package.json (build identity)
$build = $clientPkg.build
if ($null -ne $build) {
  if ($null -ne $build.buildVersion -and [string]$build.buildVersion -ne "" -and [string]$build.buildVersion -ne $packageClientVersion) {
    Fail "Client build.buildVersion='$($build.buildVersion)' != package.json version='$packageClientVersion'. Remove override or sync."
  }
  if ($null -ne $build.extraMetadata -and $null -ne $build.extraMetadata.version) {
    $em = [string]$build.extraMetadata.version
    if ($em -ne "" -and $em -ne $packageClientVersion) {
      Fail "Client build.extraMetadata.version='$em' != package.json version='$packageClientVersion'. Remove override or sync."
    }
  }
}

# OTA release metadata client.version comes from git tag (not package.json)
$tagClientVersion = $null
if ($Tag) {
  $tagRaw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "parse-release-tag.ps1") -Tag $Tag
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $parsed = Read-JsonStdout $tagRaw
  $tagClientVersion = [string]$parsed.clientVersion
  Assert-Semver "git tag client version" $tagClientVersion
  if ($tagClientVersion -ne $packageClientVersion) {
    Write-Diag "WARNING: TAG_PKG_DRIFT: tag client=$tagClientVersion package.json client=$packageClientVersion - release-metadata uses TAG; ensure app.getVersion / package.json are bumped when intended."
  }
}

$releaseClientVersion = if ($tagClientVersion) { $tagClientVersion } else { $packageClientVersion }

Write-Diag "VERSION_GATE_OK packageClient=$packageClientVersion releaseClient=$releaseClientVersion agent=$agentVersion tag=$Tag"
[Console]::Out.WriteLine((@{
  packageClientVersion = $packageClientVersion
  clientVersion        = $releaseClientVersion
  agentVersion         = $agentVersion
  tag                  = $Tag
  tagClientVersion     = $tagClientVersion
} | ConvertTo-Json -Compress))
