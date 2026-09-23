# Set mjh-printer-client/package.json version from git tag (CI workspace only; do not commit).
# Usage:
#   .\scripts\set-client-version-from-tag.ps1 -Tag v1.0.12
#   .\scripts\set-client-version-from-tag.ps1 -Tag v1.0.12 -WorkspaceRoot D:\Project
#
# stdout: JSON only { "tag","clientVersion","previousVersion","packageJson" }
# stderr: diagnostics

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

$tmpJs = Join-Path $env:TEMP ("mjh-set-client-ver-" + [guid]::NewGuid().ToString("n") + ".js")
$js = @"
const fs = require("fs");
const p = process.argv[2];
const ver = process.argv[3];
const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
const previous = String(pkg.version || "");
pkg.version = ver;
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + "\n", "utf8");
const check = JSON.parse(fs.readFileSync(p, "utf8"));
if (String(check.version) !== ver) {
  console.error("write verify failed: " + check.version);
  process.exit(2);
}
process.stdout.write(JSON.stringify({ previousVersion: previous, clientVersion: ver }));
"@
try {
  [System.IO.File]::WriteAllText($tmpJs, $js, (New-Object System.Text.UTF8Encoding $false))
  $nodeOut = & node $tmpJs $pkgPath $clientVersion
  if ($LASTEXITCODE -ne 0) { Fail "node failed to write package.json" }
} finally {
  Remove-Item -LiteralPath $tmpJs -Force -ErrorAction SilentlyContinue
}

$nodeInfo = $nodeOut | ConvertFrom-Json
$previous = [string]$nodeInfo.previousVersion

[Console]::Error.WriteLine("SET_CLIENT_VERSION_OK $previous -> $clientVersion ($pkgPath)")
[Console]::Out.WriteLine((@{
  tag             = $Tag
  clientVersion   = $clientVersion
  previousVersion = $previous
  packageJson     = $pkgPath
} | ConvertTo-Json -Compress))
