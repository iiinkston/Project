# Set mjh-printer-client/package.json version from git tag (CI workspace only; do not commit).
# Usage:
#   .\scripts\set-client-version-from-tag.ps1 -Tag v1.0.13
# stdout: JSON only

param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$WorkspaceRoot = ""
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  [Console]::Error.WriteLine("SET_CLIENT_VERSION_FAIL: $msg")
  exit 1
}

if (-not $WorkspaceRoot) {
  $WorkspaceRoot = Split-Path -Parent $PSScriptRoot
}

$parseScript = Join-Path $PSScriptRoot "parse-release-tag.ps1"
$tagRaw = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $parseScript -Tag $Tag
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$line = @($tagRaw) | Where-Object { $_ -and ("$_").Trim().StartsWith("{") } | Select-Object -Last 1
if (-not $line) { Fail "parse-release-tag produced no JSON" }
$tagInfo = $line | ConvertFrom-Json
$clientVersion = [string]$tagInfo.clientVersion
if ($clientVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "invalid clientVersion='$clientVersion'"
}

$pkgPath = Join-Path $WorkspaceRoot "mjh-printer-client\package.json"
if (-not (Test-Path -LiteralPath $pkgPath)) { Fail "missing $pkgPath" }

$patcher = Join-Path $PSScriptRoot "patch-client-package-version.cjs"
$nodeOut = & node $patcher --version $clientVersion --package $pkgPath
if ($LASTEXITCODE -ne 0) { Fail "patch-client-package-version.cjs failed" }

$nodeInfo = $nodeOut | ConvertFrom-Json
[Console]::Out.WriteLine((@{
  tag             = $Tag
  clientVersion   = $clientVersion
  previousVersion = [string]$nodeInfo.previousVersion
  packageJson     = $pkgPath
} | ConvertTo-Json -Compress))
