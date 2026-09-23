#Requires -Version 5.1
# Called from NSIS customInstall after files are laid down.
# Writes restart-request and launches Client into interactive user session (SYSTEM-safe).
$ErrorActionPreference = "Continue"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$life = Join-Path $here "client-update-lifecycle.ps1"
if (-not (Test-Path -LiteralPath $life)) {
  Write-Host "lifecycle lib missing: $life"
  exit 0
}
. $life

$InstallDir = Get-MjhClientInstallDir
$ClientExe = Get-MjhClientExePath -InstallDir $InstallDir
$ProgramDataDir = Join-Path $env:ProgramData "MJH Printer Client"
$logDir = Join-Path $ProgramDataDir "logs"
$logFile = Join-Path $logDir "client-update.log"

function Write-NsisLaunchLog([string]$Message) {
  $line = "{0} NSIS_LAUNCH {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $Message
  try {
    if (-not (Test-Path -LiteralPath $logDir)) {
      New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    }
    Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  } catch { }
  Write-Host $Message
}

$installedVersion = Get-MjhInstalledClientVersion -InstallDir $InstallDir -ClientExe $ClientExe
Write-NsisLaunchLog "start path=$ClientExe installedVersion=$installedVersion system=$(Test-MjhRunningAsSystem)"
if (-not (Test-Path -LiteralPath $ClientExe)) {
  Write-NsisLaunchLog "ERROR missing exe"
  exit 0
}

$restart = Invoke-MjhUserSessionRestart `
  -ClientExe $ClientExe `
  -TargetVersion ($(if ($installedVersion) { $installedVersion } else { "" })) `
  -InstalledVersion ($(if ($installedVersion) { $installedVersion } else { "" })) `
  -ProgramDataDir $ProgramDataDir `
  -Log { param($m) Write-NsisLaunchLog $m } `
  -SettleSeconds 2

Write-NsisLaunchLog ("launchMethod={0} launchResult={1} pid={2}" -f $restart.launchMethod, $restart.launchResult, $restart.pid)
# Non-fatal for NSIS; update-client.ps1 will retry / fail hard if needed.
exit 0
