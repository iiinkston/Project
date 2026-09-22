#Requires -Version 5.1
param(
  [Parameter(Mandatory = $true)]
  [string]$SetupPath
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
$LogDir = Join-Path $env:LOCALAPPDATA "MJH Printer Client\logs"
$LogFile = Join-Path $LogDir "client-update.log"

function Write-UpdateLog([string]$Message) {
  try {
    if (-not (Test-Path $LogDir)) {
      New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    }
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $Message
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
  } catch {
    # ignore
  }
  Write-Host $Message
}

if (-not (Test-Path -LiteralPath $SetupPath)) {
  throw "Setup not found: $SetupPath"
}

Write-UpdateLog "CLIENT UPDATE START setup=$SetupPath"

Write-UpdateLog "Stopping Client processes..."
Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
cmd /c 'taskkill /IM "MJH Printer Client.exe" /F /T >nul 2>&1'
Start-Sleep -Seconds 1

Write-UpdateLog "Running silent NSIS setup..."
# perMachine installer typically needs elevation
$p = Start-Process -FilePath $SetupPath -ArgumentList "/S" -Wait -PassThru -Verb RunAs
$exitCode = 0
if ($null -ne $p) { $exitCode = $p.ExitCode }
Write-UpdateLog "Setup exitCode=$exitCode"

Start-Sleep -Seconds 2

if (-not (Test-Path -LiteralPath $ClientExe)) {
  Write-UpdateLog "WARN: Client EXE missing after setup: $ClientExe"
  throw "Client EXE not found after update"
}

Write-UpdateLog "Restarting Client: $ClientExe"
Start-Process -FilePath $ClientExe | Out-Null
Write-UpdateLog "CLIENT UPDATE DONE"
