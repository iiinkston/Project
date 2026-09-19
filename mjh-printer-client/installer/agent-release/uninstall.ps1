#Requires -RunAsAdministrator
param(
  [switch]$PurgeData
)

$ErrorActionPreference = "Stop"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$InstallDir = Join-Path $env:ProgramFiles $ProductName
$ProgramDataDir = Join-Path $env:ProgramData $ProductName

Write-Host "=== Uninstalling $ProductName ==="

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Scheduled task removed."
}

Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -like "*MJH-Printer-Agent.exe*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "Removed $InstallDir"
}

if ($PurgeData) {
  if (Test-Path $ProgramDataDir) {
    Remove-Item -Recurse -Force $ProgramDataDir
    Write-Host "Purged $ProgramDataDir"
  }
} else {
  Write-Host "ProgramData retained at $ProgramDataDir (use -PurgeData to delete)."
}

Write-Host "Uninstall complete."
