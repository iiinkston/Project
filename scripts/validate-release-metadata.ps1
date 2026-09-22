# Validate nested OTA release-metadata.json after assets + hashes are staged.
# Usage:
#   .\scripts\validate-release-metadata.ps1 -MetadataPath release\release-metadata.json `
#     -ClientSetupPath release\MJH-Printer-Setup.exe `
#     -AgentZipPath release\MJH-Printer-Agent-v2.4.8.zip `
#     -ExpectedClientVersion 1.0.8 -ExpectedAgentVersion 2.4.8

param(
  [Parameter(Mandatory = $true)][string]$MetadataPath,
  [Parameter(Mandatory = $true)][string]$ClientSetupPath,
  [Parameter(Mandatory = $true)][string]$AgentZipPath,
  [Parameter(Mandatory = $true)][string]$ExpectedClientVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedAgentVersion
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  Write-Error "METADATA_GATE_FAIL: $msg"
  exit 1
}

if (-not (Test-Path -LiteralPath $MetadataPath)) { Fail "missing metadata: $MetadataPath" }
if (-not (Test-Path -LiteralPath $ClientSetupPath)) { Fail "missing client setup: $ClientSetupPath" }
if (-not (Test-Path -LiteralPath $AgentZipPath)) { Fail "missing agent zip: $AgentZipPath" }

$meta = Get-Content -LiteralPath $MetadataPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $meta.client -or -not $meta.agent) {
  Fail "metadata must be nested { client:{}, agent:{} }"
}

foreach ($side in @("client", "agent")) {
  $c = $meta.$side
  foreach ($f in @("version", "url", "sha256")) {
    if (-not [string]$c.$f) { Fail "$side.$f missing" }
  }
  if ([string]$c.sha256 -notmatch '^[a-f0-9]{64}$') {
    Fail "$side.sha256 must be 64 lowercase hex (got '$($c.sha256)')"
  }
  if ([string]$c.url -notmatch '^https://') {
    Fail "$side.url must be https (got '$($c.url)')"
  }
}

if ([string]$meta.client.version -ne $ExpectedClientVersion) {
  Fail "client.version='$($meta.client.version)' != expected '$ExpectedClientVersion'"
}
if ([string]$meta.agent.version -ne $ExpectedAgentVersion) {
  Fail "agent.version='$($meta.agent.version)' != expected '$ExpectedAgentVersion'"
}

$clientSha = (Get-FileHash -LiteralPath $ClientSetupPath -Algorithm SHA256).Hash.ToLowerInvariant()
$agentSha = (Get-FileHash -LiteralPath $AgentZipPath -Algorithm SHA256).Hash.ToLowerInvariant()

if ($clientSha -ne [string]$meta.client.sha256) {
  Fail "client sha256 mismatch file=$clientSha meta=$($meta.client.sha256)"
}
if ($agentSha -ne [string]$meta.agent.sha256) {
  Fail "agent sha256 mismatch file=$agentSha meta=$($meta.agent.sha256)"
}

$expectedAgentName = "MJH-Printer-Agent-v$ExpectedAgentVersion.zip"
if ([IO.Path]::GetFileName($AgentZipPath) -ne $expectedAgentName) {
  Fail "agent zip filename must be '$expectedAgentName' (got '$(Split-Path $AgentZipPath -Leaf)')"
}

Write-Host "METADATA_GATE_OK client=$ExpectedClientVersion agent=$ExpectedAgentVersion"
