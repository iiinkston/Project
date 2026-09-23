#Requires -Version 5.1
<#
  Client OTA installer runner.
  Expected to run elevated (SYSTEM task or UAC RunAs). Do NOT nest -Verb RunAs.

  Lifecycle:
    stop Client -> NSIS /S -> verify installedVersion==targetVersion
    -> write restart-request -> user-session launch (never Session 0 from SYSTEM)
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,
  [string]$OldVersion = "",
  [string]$NewVersion = "",
  [string]$ExpectedSha256 = ""
)

$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Client"

$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$ProgramDataLogDir = Join-Path $ProgramDataDir "logs"
$ProgramDataLogFile = Join-Path $ProgramDataLogDir "client-update.log"
$LocalLogDir = Join-Path $env:LOCALAPPDATA "$ProductName\logs"
$LocalLogFile = Join-Path $LocalLogDir "client-update.log"
$InstallerStartPath = Join-Path $ProgramDataDir "updates\installer-start.log"

$LifecycleLib = Join-Path $PSScriptRoot "client-update-lifecycle.ps1"
if (-not (Test-Path -LiteralPath $LifecycleLib)) {
  $LifecycleLib = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "client-update-lifecycle.ps1"
}
if (-not (Test-Path -LiteralPath $LifecycleLib)) {
  Write-Host "CLIENT UPDATE FAILED reason=lifecycle_lib_missing"
  exit 1
}
. $LifecycleLib

function Write-UpdateLog([string]$Message) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $Message
  foreach ($pair in @(
      @{ Dir = $ProgramDataLogDir; File = $ProgramDataLogFile },
      @{ Dir = $LocalLogDir; File = $LocalLogFile }
    )) {
    try {
      if (-not (Test-Path -LiteralPath $pair.Dir)) {
        New-Item -ItemType Directory -Force -Path $pair.Dir | Out-Null
      }
      Add-Content -LiteralPath $pair.File -Value $line -Encoding UTF8
    } catch {
      # ignore per-path failures
    }
  }
  Write-Host $Message
}

function Write-InstallerStartJson([hashtable]$Obj) {
  try {
    $dir = Split-Path -Parent $InstallerStartPath
    if (-not (Test-Path -LiteralPath $dir)) {
      New-Item -ItemType Directory -Force -Path $dir | Out-Null
    }
    $json = ($Obj | ConvertTo-Json -Compress)
    Add-Content -LiteralPath $InstallerStartPath -Value $json -Encoding UTF8
  } catch {
    # ignore
  }
}

function Fail-Update([string]$Reason, [int]$Code = 1) {
  Write-UpdateLog ("CLIENT UPDATE FAILED reason={0}" -f $Reason)
  Write-InstallerStartJson @{
    event = "CLIENT_UPDATE_FAILED"
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    reason = $Reason
    oldVersion = $OldVersion
    targetVersion = $NewVersion
  }
  exit $Code
}

$logSb = { param($m) Write-UpdateLog $m }

if (-not (Test-Path -LiteralPath $SetupPath)) {
  Fail-Update "setup_not_found:$SetupPath" 2
}

$setupFull = (Resolve-Path -LiteralPath $SetupPath).Path
$InstallDir = Get-MjhClientInstallDir
$ClientExe = Get-MjhClientExePath -InstallDir $InstallDir
$startedAt = (Get-Date).ToUniversalTime().ToString("o")

Write-UpdateLog "CLIENT UPDATE START"
Write-UpdateLog "time=$startedAt"
Write-UpdateLog "oldVersion=$OldVersion"
Write-UpdateLog "targetVersion=$NewVersion"
Write-UpdateLog "installerPath=$setupFull"
Write-UpdateLog "installDir=$InstallDir"
Write-UpdateLog "clientExe=$ClientExe"
Write-UpdateLog "pid=$PID"
Write-UpdateLog ("runningAsSystem={0}" -f (Test-MjhRunningAsSystem))

if (-not $NewVersion -or $NewVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail-Update "missing_or_invalid_targetVersion:$NewVersion" 5
}

$shaActual = $null
try {
  $shaActual = (Get-FileHash -LiteralPath $setupFull -Algorithm SHA256).Hash.ToLowerInvariant()
  Write-UpdateLog "sha256=$shaActual"
} catch {
  Fail-Update "sha256_failed:$($_.Exception.Message)" 3
}

if ($ExpectedSha256) {
  $want = ($ExpectedSha256.Trim().ToLowerInvariant() -replace '^sha256:', '')
  if ($shaActual -ne $want) {
    Fail-Update "sha256_mismatch actual=$shaActual expected=$want" 4
  }
  Write-UpdateLog "sha256Result=PASS"
} else {
  Write-UpdateLog "sha256Result=SKIPPED (no ExpectedSha256)"
}

Write-InstallerStartJson @{
  event = "CLIENT_UPDATE_START"
  timestamp = $startedAt
  oldVersion = $OldVersion
  targetVersion = $NewVersion
  installerPath = $setupFull
  sha256 = $shaActual
  helperPid = $PID
}

Write-UpdateLog "Stopping Client processes..."
Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
cmd /c 'taskkill /IM "MJH Printer Client.exe" /F /T >nul 2>&1'
Start-Sleep -Seconds 1

$installerStartTime = (Get-Date).ToUniversalTime().ToString("o")
Write-UpdateLog "installerStartTime=$installerStartTime"
Write-UpdateLog "CLIENT INSTALL PROCESS START"
$p = Start-Process -FilePath $setupFull -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
$exitCode = if ($null -ne $p) { [int]$p.ExitCode } else { -1 }
$setupPid = if ($null -ne $p) { [int]$p.Id } else { 0 }
$installerEndTime = (Get-Date).ToUniversalTime().ToString("o")

Write-UpdateLog "CLIENT INSTALL PROCESS pid=$setupPid"
Write-UpdateLog "CLIENT INSTALL FINISHED"
Write-UpdateLog "installerEndTime=$installerEndTime"
Write-UpdateLog "installerExitCode=$exitCode"

Write-InstallerStartJson @{
  event = "CLIENT_INSTALL_FINISHED"
  timestamp = $installerEndTime
  oldVersion = $OldVersion
  targetVersion = $NewVersion
  installerPath = $setupFull
  pid = $setupPid
  installerExitCode = $exitCode
}

if ($exitCode -ne 0) {
  Fail-Update "installer_exitCode=$exitCode" $exitCode
}

Start-Sleep -Seconds 2
Stop-MjhSession0ClientProcesses -Log $logSb

$assert = Assert-MjhClientInstalled `
  -InstallDir $InstallDir `
  -ClientExe $ClientExe `
  -TargetVersion $NewVersion `
  -Log $logSb

Write-UpdateLog ("installedPath={0}" -f $assert.installedPath)
Write-UpdateLog ("installedVersion={0}" -f ($(if ($assert.installedVersion) { $assert.installedVersion } else { "(unknown)" })))

if (-not $assert.ok) {
  Fail-Update ("verify_failed:{0}" -f $assert.error) 10
}

if ([string]$assert.installedVersion -ne $NewVersion) {
  Fail-Update ("version_mismatch installed={0} target={1}" -f $assert.installedVersion, $NewVersion) 10
}

Write-UpdateLog "postInstallVerify=PASS"

$restart = Invoke-MjhUserSessionRestart `
  -ClientExe $ClientExe `
  -OldVersion $OldVersion `
  -TargetVersion $NewVersion `
  -InstalledVersion ([string]$assert.installedVersion) `
  -ProgramDataDir $ProgramDataDir `
  -Log $logSb `
  -SettleSeconds 3

Write-UpdateLog ("launchMethod={0}" -f $restart.launchMethod)
Write-UpdateLog ("launchResult={0}" -f $restart.launchResult)
if ($restart.pid) { Write-UpdateLog ("launchPid={0}" -f $restart.pid) }

if (-not $restart.ok) {
  Fail-Update ("launch_failed:{0}" -f $restart.error) 11
}

Write-InstallerStartJson @{
  event = "CLIENT_UPDATE_DONE"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
  oldVersion = $OldVersion
  targetVersion = $NewVersion
  installedVersion = [string]$assert.installedVersion
  installedPath = [string]$assert.installedPath
  launchMethod = [string]$restart.launchMethod
  launchResult = [string]$restart.launchResult
  launchPid = $restart.pid
  installerExitCode = 0
}

Write-UpdateLog "CLIENT UPDATE DONE"
exit 0
