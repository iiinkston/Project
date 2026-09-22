#Requires -Version 5.1
<#
  Client OTA installer runner.
  Expected to run elevated (SYSTEM task or UAC RunAs). Do NOT nest -Verb RunAs.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath,
  [string]$OldVersion = "",
  [string]$NewVersion = ""
)

$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Client"
$ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
  $env:ProgramW6432
} else {
  ${env:ProgramFiles}
}
$InstallDir = Join-Path $ProgramFiles64 "MJH Printer"
$ClientExe = Join-Path $InstallDir "MJH Printer Client.exe"

$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$ProgramDataLogDir = Join-Path $ProgramDataDir "logs"
$ProgramDataLogFile = Join-Path $ProgramDataLogDir "client-update.log"
$LocalLogDir = Join-Path $env:LOCALAPPDATA "$ProductName\logs"
$LocalLogFile = Join-Path $LocalLogDir "client-update.log"
$InstallerStartPath = Join-Path $ProgramDataDir "updates\installer-start.log"

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

if (-not (Test-Path -LiteralPath $SetupPath)) {
  Write-UpdateLog "ERROR Setup not found: $SetupPath"
  throw "Setup not found: $SetupPath"
}

$setupFull = (Resolve-Path -LiteralPath $SetupPath).Path
$startedAt = (Get-Date).ToUniversalTime().ToString("o")

Write-UpdateLog "CLIENT UPDATE START"
Write-UpdateLog "time=$startedAt"
Write-UpdateLog "oldVersion=$OldVersion"
Write-UpdateLog "newVersion=$NewVersion"
Write-UpdateLog "installer=$setupFull"
Write-UpdateLog "pid=$PID"

Write-InstallerStartJson @{
  event = "CLIENT_UPDATE_START"
  timestamp = $startedAt
  oldVersion = $OldVersion
  newVersion = $NewVersion
  installerPath = $setupFull
  helperPid = $PID
}

Write-UpdateLog "Stopping Client processes..."
Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
cmd /c 'taskkill /IM "MJH Printer Client.exe" /F /T >nul 2>&1'
Start-Sleep -Seconds 1

Write-UpdateLog "CLIENT INSTALL PROCESS START"
# Already elevated (task/UAC): silent per-machine NSIS. Do not nest RunAs.
$p = Start-Process -FilePath $setupFull -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
$exitCode = if ($null -ne $p) { [int]$p.ExitCode } else { -1 }
$setupPid = if ($null -ne $p) { [int]$p.Id } else { 0 }

Write-UpdateLog "CLIENT INSTALL PROCESS START pid=$setupPid"
Write-UpdateLog "CLIENT INSTALL FINISHED"
Write-UpdateLog "exitCode=$exitCode"

Write-InstallerStartJson @{
  event = "CLIENT_INSTALL_FINISHED"
  timestamp = (Get-Date).ToUniversalTime().ToString("o")
  oldVersion = $OldVersion
  newVersion = $NewVersion
  installerPath = $setupFull
  pid = $setupPid
  exitCode = $exitCode
}

if ($exitCode -ne 0) {
  Write-UpdateLog "ERROR Setup failed exitCode=$exitCode"
  exit $exitCode
}

Start-Sleep -Seconds 2

if (-not (Test-Path -LiteralPath $ClientExe)) {
  Write-UpdateLog "ERROR Client EXE missing after setup: $ClientExe"
  throw "Client EXE not found after update"
}

Write-UpdateLog "Restarting Client: $ClientExe"
Start-Process -FilePath $ClientExe | Out-Null
Write-UpdateLog "CLIENT UPDATE DONE"
exit 0
