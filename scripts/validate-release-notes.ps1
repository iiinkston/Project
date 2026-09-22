# Validate Release Notes Client Setup version == release-metadata.json client.version.
# Usage:
#   .\scripts\validate-release-notes.ps1 `
#     -NotesPath release\RELEASE_NOTES.md `
#     -MetadataPath release\release-metadata.json

param(
  [Parameter(Mandatory = $true)][string]$NotesPath,
  [Parameter(Mandatory = $true)][string]$MetadataPath
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  Write-Error "RELEASE_NOTES_GATE_FAIL: $msg"
  exit 1
}

if (-not (Test-Path -LiteralPath $NotesPath)) { Fail "missing notes: $NotesPath" }
if (-not (Test-Path -LiteralPath $MetadataPath)) { Fail "missing metadata: $MetadataPath" }

$notes = Get-Content -LiteralPath $NotesPath -Raw -Encoding UTF8
$meta = Get-Content -LiteralPath $MetadataPath -Raw -Encoding UTF8 | ConvertFrom-Json

if (-not $meta.client -or -not [string]$meta.client.version) {
  Fail "metadata missing client.version"
}

$metaClient = [string]$meta.client.version

# Expect a table row like: | Client Setup | `1.0.10` |
$m = [regex]::Match($notes, '(?m)^\|\s*Client Setup\s*\|\s*`(?<ver>\d+\.\d+\.\d+)`\s*\|')
if (-not $m.Success) {
  Fail "Release notes missing '| Client Setup | ``X.Y.Z`` |' row"
}

$notesClient = $m.Groups['ver'].Value
if ($notesClient -ne $metaClient) {
  Fail "Release notes Client Setup='$notesClient' != metadata client.version='$metaClient'"
}

Write-Host "RELEASE_NOTES_GATE_OK client=$notesClient (matches metadata)"
