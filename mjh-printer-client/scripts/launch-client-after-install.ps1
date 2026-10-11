#Requires -Version 5.1
# Called from NSIS customInstall after Agent install + Client OTA task registration.
# Accepts -ClientInstallDir "$INSTDIR" so custom install paths (e.g. D:\...) work.
param(
  [string]$ClientInstallDir = ""
)
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$life = Join-Path $here "client-update-lifecycle.ps1"
if (-not (Test-Path -LiteralPath $life)) {
  Write-Host "lifecycle lib missing: $life"
  exit 2
}
. $life

# Prefer real install root derived from this script location:
#   <InstallDir>\resources\updater\launch-client-after-install.ps1
$fromPackage = $null
try {
  $resourcesDir = Split-Path -Parent $here
  if ((Split-Path -Leaf $resourcesDir) -eq "resources") {
    $fromPackage = Split-Path -Parent $resourcesDir
  }
} catch { }

if ($ClientInstallDir -and $ClientInstallDir.Trim().Length -gt 0) {
  $InstallDir = $ClientInstallDir.Trim()
} elseif ($fromPackage) {
  $InstallDir = $fromPackage
} else {
  $InstallDir = Get-MjhClientInstallDir
}

$ClientExe = Get-MjhClientExePath -InstallDir $InstallDir
$ProgramDataDir = Join-Path $env:ProgramData "MJH Printer Client"
$logDir = Join-Path $ProgramDataDir "logs"
$logFile = Join-Path $logDir "installer-start.log"
$HealthUrl = "http://127.0.0.1:17890/local/health"
$MaxAttempts = 30
$IntervalSeconds = 1
$ExeWaitAttempts = 15

function Write-InstallerStartLog([string]$Message) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $Message
  try {
    if (-not (Test-Path -LiteralPath $logDir)) {
      New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch { }
  Write-Host $Message
}

function Test-AgentHealth {
  try {
    $res = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 300) {
      $body = [string]$res.Content
      if ($body -match '"ok"\s*:\s*true' -or $body -match 'ok') {
        return $true
      }
    }
  } catch { }
  return $false
}

Write-InstallerStartLog "INSTALLER_HEALTH_START url=$HealthUrl maxAttempts=$MaxAttempts"
Write-InstallerStartLog ("installDir=$InstallDir fromPackage=$fromPackage")
Write-InstallerStartLog ("clientExe=$ClientExe system=$(Test-MjhRunningAsSystem)")

$healthy = $false
for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
  $ok = Test-AgentHealth
  Write-InstallerStartLog ("INSTALLER_HEALTH_ATTEMPT attempt={0} ok={1}" -f $attempt, $ok)
  if ($ok) {
    $healthy = $true
    Write-InstallerStartLog "INSTALLER_HEALTH_SUCCESS"
    break
  }
  if ($attempt -lt $MaxAttempts) {
    Start-Sleep -Seconds $IntervalSeconds
  }
}

if (-not $healthy) {
  Write-InstallerStartLog "INSTALLER_HEALTH_FAILED"
  Write-InstallerStartLog "reason=AGENT_HEALTH_UNAVAILABLE"
  Write-InstallerStartLog "userMessage=AGENT_START_FAILED"
  exit 2
}

# Wait until Client EXE is visible (custom InstallDir / delayed file commit).
$exeReady = $false
for ($i = 1; $i -le $ExeWaitAttempts; $i++) {
  $ClientExe = Get-MjhClientExePath -InstallDir $InstallDir
  if (-not (Test-Path -LiteralPath $ClientExe) -and $fromPackage) {
    $ClientExe = Get-MjhClientExePath -InstallDir $fromPackage
  }
  if (-not (Test-Path -LiteralPath $ClientExe)) {
    $regExe = Find-MjhClientExeViaRegistry
    if ($regExe) { $ClientExe = $regExe }
  }
  Write-InstallerStartLog ("CLIENT_EXE_WAIT attempt={0} path={1} exists={2}" -f $i, $ClientExe, (Test-Path -LiteralPath $ClientExe))
  if (Test-Path -LiteralPath $ClientExe) {
    $exeReady = $true
    $InstallDir = Split-Path -Parent $ClientExe
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $exeReady) {
  Write-InstallerStartLog "INSTALLER_CLIENT_EXE_MISSING"
  Write-InstallerStartLog ("reason=CLIENT_EXE_NOT_FOUND tried=$ClientExe")
  Write-InstallerStartLog "userMessage=CLIENT_EXE_MISSING"
  exit 4
}

$installedVersion = Get-MjhInstalledClientVersion -InstallDir $InstallDir -ClientExe $ClientExe
$verShown = if ($installedVersion) { $installedVersion } else { "(unknown)" }
Write-InstallerStartLog ("launch start installedVersion={0}" -f $verShown)

$targetVer = if ($installedVersion) { $installedVersion } else { "" }
$restart = Invoke-MjhUserSessionRestart `
  -ClientExe $ClientExe `
  -TargetVersion $targetVer `
  -InstalledVersion $targetVer `
  -ProgramDataDir $ProgramDataDir `
  -Log { param($m) Write-InstallerStartLog $m } `
  -SettleSeconds 2

Write-InstallerStartLog ("launchMethod={0} launchResult={1} pid={2}" -f $restart.launchMethod, $restart.launchResult, $restart.pid)

if (-not $restart.ok) {
  Write-InstallerStartLog ("INSTALLER_LAUNCH_FAILED error={0}" -f $restart.error)
  Write-InstallerStartLog "userMessage=CLIENT_LAUNCH_FAILED"
  exit 3
}

Write-InstallerStartLog "INSTALLER_LAUNCH_SUCCESS"
exit 0
