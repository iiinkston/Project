# Generate GitHub Release notes body for OTA releases.
# Client Setup version MUST come from git tag semver (not package.json).
# Agent version comes from agent package.json.
#
# Usage:
#   .\scripts\generate-release-notes.ps1 `
#     -Tag v1.0.10 -ClientVersion 1.0.10 -AgentVersion 2.4.8 `
#     -Repository owner/repo -OutFile release\RELEASE_NOTES.md

param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [Parameter(Mandatory = $true)][string]$ClientVersion,
  [Parameter(Mandatory = $true)][string]$AgentVersion,
  [Parameter(Mandatory = $true)][string]$Repository,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  Write-Error "RELEASE_NOTES_FAIL: $msg"
  exit 1
}

if ($ClientVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "ClientVersion='$ClientVersion' must be X.Y.Z (from git tag)"
}
if ($AgentVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "AgentVersion='$AgentVersion' must be X.Y.Z"
}

$manifestUrl = "https://github.com/$Repository/releases/download/$Tag/release-metadata.json"

$body = @"
## MJH Printer OTA $Tag

| Package | Version |
|---------|---------|
| Client Setup | ``$ClientVersion`` |
| Agent | ``$AgentVersion`` |

### Assets
- ``MJH-Printer-Setup.exe``
- ``MJH-Printer-Agent-v$AgentVersion.zip``
- ``release-metadata.json`` (nested ``{ client, agent }`` + SHA256; **client.version from git tag**)

Cloud ``REMOTE_MANIFEST_URL``:
``$manifestUrl``
"@

$dir = Split-Path -Parent $OutFile
if ($dir -and -not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

[System.IO.File]::WriteAllText($OutFile, $body.TrimEnd() + "`n", (New-Object System.Text.UTF8Encoding $false))
Write-Host "RELEASE_NOTES_OK client=$ClientVersion agent=$AgentVersion out=$OutFile"
