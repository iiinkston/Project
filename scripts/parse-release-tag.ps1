# Parse OTA release git tag → numeric client semver for release-metadata.json.
# Usage:
#   .\scripts\parse-release-tag.ps1 -Tag v1.0.9
# Output (stdout): JSON { "tag":"v1.0.9", "clientVersion":"1.0.9" }

param(
  [Parameter(Mandatory = $true)]
  [string]$Tag
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  Write-Error "TAG_PARSE_FAIL: $msg"
  exit 1
}

$t = $Tag.Trim()
if (-not $t) { Fail "Tag is empty" }
if ($t -notmatch '^v') { Fail "Tag '$t' must start with 'v'" }
if ($t -match '(?i)test') { Fail "Tag '$t' looks like a test tag" }

$clientVersion = $t -replace '^v', ''
if ($clientVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "Tag '$t' must be vX.Y.Z (got clientVersion='$clientVersion')"
}

$result = [ordered]@{
  tag           = $t
  clientVersion = $clientVersion
}
Write-Output ($result | ConvertTo-Json -Compress)
