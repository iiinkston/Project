# Validate unified MJH Printer Windows installer packaging (static gates).
# Usage:
#   .\scripts\validate-unified-installer.ps1 `
#     -ExpectedClientVersion 1.0.15 `
#     -ExpectedAgentVersion 2.4.9 `
#     -SetupPath "dist\client-build\MJH Printer Setup.exe" `
#     -AgentReleaseDir "mjh-printer-client\installer\agent-release"

param(
  [Parameter(Mandatory = $true)][string]$ExpectedClientVersion,
  [Parameter(Mandatory = $true)][string]$ExpectedAgentVersion,
  [string]$WorkspaceRoot = "",
  [string]$SetupPath = "",
  [string]$AgentReleaseDir = "",
  [string]$AsarPath = "",
  [string]$UnpackedDir = ""
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  [Console]::Error.WriteLine("UNIFIED_INSTALLER_FAIL: $msg")
  exit 1
}

function Ok([string]$msg) {
  Write-Host "UNIFIED_INSTALLER_OK: $msg"
}

if (-not $WorkspaceRoot) {
  $WorkspaceRoot = Split-Path -Parent $PSScriptRoot
}
$WorkspaceRoot = (Resolve-Path -LiteralPath $WorkspaceRoot).Path

if ($ExpectedClientVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "ExpectedClientVersion='$ExpectedClientVersion' must be X.Y.Z"
}
if ($ExpectedAgentVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "ExpectedAgentVersion='$ExpectedAgentVersion' must be X.Y.Z"
}

if (-not $AgentReleaseDir) {
  $AgentReleaseDir = Join-Path $WorkspaceRoot "mjh-printer-client\installer\agent-release"
}
if (-not (Test-Path -LiteralPath $AgentReleaseDir)) {
  Fail "Agent release stage missing: $AgentReleaseDir"
}
$AgentReleaseDir = (Resolve-Path -LiteralPath $AgentReleaseDir).Path
Ok "agentReleaseDir=$AgentReleaseDir"

$agentExe = Join-Path $AgentReleaseDir "MJH-Printer-Agent.exe"
if (-not (Test-Path -LiteralPath $agentExe)) {
  Fail "Agent EXE missing in stage: $agentExe"
}
Ok "agentExe=$agentExe"

$buildTxt = Join-Path $AgentReleaseDir "BUILD.txt"
if (-not (Test-Path -LiteralPath $buildTxt)) {
  Fail "BUILD.txt missing in stage: $buildTxt"
}
$buildRaw = Get-Content -LiteralPath $buildTxt -Raw -Encoding UTF8
if ($buildRaw -notmatch [regex]::Escape($ExpectedAgentVersion)) {
  Fail "BUILD.txt does not contain ExpectedAgentVersion=$ExpectedAgentVersion"
}
Ok "agentBuildVersion=$ExpectedAgentVersion"

# Embedded allowlist only
$requiredAgentScripts = @(
  "install.ps1",
  "uninstall.ps1",
  "update-agent.ps1",
  "apply-update-helper.ps1"
)
foreach ($name in $requiredAgentScripts) {
  $p = Join-Path $AgentReleaseDir $name
  if (-not (Test-Path -LiteralPath $p)) {
    Fail "required Agent script missing: $name"
  }
}
Ok "agentScripts=present"

$forbidden = @(
  "README.md",
  "start.ps1",
  "stop.ps1",
  "restart.ps1",
  "status.ps1",
  "logs.ps1"
)
foreach ($name in $forbidden) {
  if (Test-Path -LiteralPath (Join-Path $AgentReleaseDir $name)) {
    Fail "forbidden file still embedded in Setup payload: $name"
  }
}
Get-ChildItem -LiteralPath $AgentReleaseDir -Filter "*.zip" -File -ErrorAction SilentlyContinue | ForEach-Object {
  Fail "unexpected Agent ZIP nested in Setup staging: $($_.Name)"
}
Ok "noNestedZipOrDevHelpers=present"

$unbound = Join-Path $AgentReleaseDir "config\printer.unbound.json"
if (-not (Test-Path -LiteralPath $unbound)) {
  Fail "printer.unbound.json missing from embedded payload"
}
$unboundRaw = Get-Content -LiteralPath $unbound -Raw -Encoding UTF8
if ($unboundRaw -match '192\.168\.0\.110') {
  Fail "old default 192.168.0.110 still present in printer.unbound.json"
}
if ($unboundRaw -match '"ip"\s*:\s*"192\.168\.') {
  Fail "printer.unbound.json must not hard-code a LAN printer IP"
}
if (Test-Path -LiteralPath (Join-Path $AgentReleaseDir "config\printer.json")) {
  Fail "config/printer.json must not be embedded (secrets / old IP risk)"
}
Ok "noOldPrinterIpDefault=present"

# Production config templates in repo
$repoUnbound = Join-Path $WorkspaceRoot "mjh-printer-agent\config\printer.unbound.json"
$repoPrinter = Join-Path $WorkspaceRoot "mjh-printer-agent\config\printer.json"
foreach ($cfg in @($repoUnbound, $repoPrinter)) {
  if (Test-Path -LiteralPath $cfg) {
    $raw = Get-Content -LiteralPath $cfg -Raw -Encoding UTF8
    if ($raw -match '192\.168\.0\.110') {
      Fail "old default 192.168.0.110 remains in $cfg"
    }
  }
}
Ok "repoConfigTemplatesClean=present"

$installPs1 = Get-Content -LiteralPath (Join-Path $AgentReleaseDir "install.ps1") -Raw -Encoding UTF8
foreach ($needle in @(
  'MJH Printer Agent',
  'MJH Printer Agent Update',
  'agent:start --agent-process',
  'ProgramData'
)) {
  if ($installPs1 -notlike "*$needle*") {
    Fail "install.ps1 missing required marker: $needle"
  }
}

$uninstallPs1 = Get-Content -LiteralPath (Join-Path $AgentReleaseDir "uninstall.ps1") -Raw -Encoding UTF8
if ($uninstallPs1 -notlike "*MJH Printer Agent Update*") {
  Fail "uninstall.ps1 must remove MJH Printer Agent Update task"
}
if ($uninstallPs1 -notlike "*PurgeData*") {
  Fail "uninstall.ps1 must support -PurgeData while default-preserving ProgramData"
}
Ok "agentInstallUninstallMarkers=present"

$clientScripts = @(
  "mjh-printer-client\scripts\register-client-ota-task.ps1",
  "mjh-printer-client\scripts\launch-client-after-install.ps1",
  "mjh-printer-client\scripts\update-client.ps1",
  "mjh-printer-client\scripts\apply-client-update-helper.ps1",
  "mjh-printer-client\scripts\client-update-lifecycle.ps1",
  "mjh-printer-client\installer\nsis-agent.nsh",
  "mjh-printer-client\installer\stage-agent.mjs"
)
foreach ($rel in $clientScripts) {
  $p = Join-Path $WorkspaceRoot $rel
  if (-not (Test-Path -LiteralPath $p)) {
    Fail "required installer script missing: $rel"
  }
}
Ok "clientInstallerScripts=present"

$nsis = Get-Content -LiteralPath (Join-Path $WorkspaceRoot "mjh-printer-client\installer\nsis-agent.nsh") -Raw -Encoding UTF8
foreach ($needle in @(
  'agent-release\install.ps1',
  'register-client-ota-task.ps1',
  'launch-client-after-install.ps1',
  'MJH Printer Client Update',
  'MJH Printer Agent Update'
)) {
  if ($nsis -notlike "*$needle*") {
    Fail "nsis-agent.nsh missing required marker: $needle"
  }
}
Ok "nsisHooks=present"

$launch = Get-Content -LiteralPath (Join-Path $WorkspaceRoot "mjh-printer-client\scripts\launch-client-after-install.ps1") -Raw -Encoding UTF8
foreach ($needle in @(
  '127.0.0.1:17890/local/health',
  'installer-start.log',
  'INSTALLER_HEALTH_',
  'Invoke-MjhUserSessionRestart'
)) {
  if ($launch -notlike "*$needle*") {
    Fail "launch-client-after-install.ps1 missing required marker: $needle"
  }
}
Ok "postInstallHealthGate=present"

$pkgPath = Join-Path $WorkspaceRoot "mjh-printer-client\package.json"
$pkg = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
$displayName = [string]$pkg.build.nsis.uninstallDisplayName
$shortcutName = [string]$pkg.build.nsis.shortcutName
if (-not $displayName -or -not $shortcutName) {
  Fail "package.json nsis.uninstallDisplayName/shortcutName must be set"
}
if ($displayName -ne $shortcutName) {
  Fail "package.json nsis.uninstallDisplayName must equal shortcutName (store brand)"
}
$pkgRaw = Get-Content -LiteralPath $pkgPath -Raw -Encoding UTF8
if ($pkgRaw -notmatch 'uninstallDisplayName') {
  Fail "package.json missing uninstallDisplayName"
}
if ($pkg.build.extraResources | Where-Object { $_.to -eq "agent-release" } | Measure-Object | Select-Object -ExpandProperty Count) {
  Ok "extraResources.agent-release=present"
} else {
  Fail "package.json extraResources must stage agent-release"
}

if (-not $SetupPath) {
  $guess = Join-Path $WorkspaceRoot "dist\client-build\MJH Printer Setup.exe"
  if (Test-Path -LiteralPath $guess) { $SetupPath = $guess }
  $guess2 = Join-Path $WorkspaceRoot "release\MJH-Printer-Setup.exe"
  if (-not $SetupPath -and (Test-Path -LiteralPath $guess2)) { $SetupPath = $guess2 }
}

if ($SetupPath) {
  if (-not (Test-Path -LiteralPath $SetupPath)) {
    Fail "Setup missing: $SetupPath"
  }
  $SetupPath = (Resolve-Path -LiteralPath $SetupPath).Path
  Ok "setup=$SetupPath"

  if (-not $AsarPath) {
    if (-not $UnpackedDir) {
      $UnpackedDir = Join-Path (Split-Path -Parent $SetupPath) "win-unpacked"
    }
    $AsarPath = Join-Path $UnpackedDir "resources\app.asar"
  }

  $verScript = Join-Path $PSScriptRoot "validate-client-build-version.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $verScript `
    -ExpectedVersion $ExpectedClientVersion `
    -SetupPath $SetupPath `
    -AsarPath $AsarPath
  if ($LASTEXITCODE -ne 0) {
    Fail "Client Setup/asar version gate failed for ExpectedClientVersion=$ExpectedClientVersion"
  }
  Ok "clientSetupProductVersion=$ExpectedClientVersion"

  $embeddedAgent = Join-Path (Split-Path -Parent $AsarPath) "agent-release\MJH-Printer-Agent.exe"
  if (Test-Path -LiteralPath $embeddedAgent) {
    Ok "embeddedAgentExe=$embeddedAgent"
    $embeddedBuild = Join-Path (Split-Path -Parent $embeddedAgent) "BUILD.txt"
    if ((Test-Path -LiteralPath $embeddedBuild) -and ((Get-Content -LiteralPath $embeddedBuild -Raw -Encoding UTF8) -notmatch [regex]::Escape($ExpectedAgentVersion))) {
      Fail "embedded BUILD.txt does not contain ExpectedAgentVersion=$ExpectedAgentVersion"
    }
    Get-ChildItem -LiteralPath (Split-Path -Parent $embeddedAgent) -Filter "*.zip" -File -ErrorAction SilentlyContinue | ForEach-Object {
      Fail "unexpected nested zip inside unpacked Setup agent-release: $($_.Name)"
    }
    if (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $embeddedAgent) "config\printer.json")) {
      Fail "unpacked Setup still embeds config/printer.json"
    }
  } else {
    Write-Host "UNIFIED_INSTALLER_WARN: unpacked agent-release EXE not found (stage-only validation used)"
  }
} else {
  Write-Host "UNIFIED_INSTALLER_WARN: SetupPath not provided; validated stage + scripts only"
}

Ok "unified installer validation PASS client=$ExpectedClientVersion agent=$ExpectedAgentVersion"
exit 0
