#Requires -RunAsAdministrator
param(
  [switch]$PurgeData
)

$ErrorActionPreference = "Stop"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
  $env:ProgramW6432
} else {
  ${env:ProgramFiles}
}
$InstallDir = Join-Path $ProgramFiles64 $ProductName
$InstallDirX86 = Join-Path ${env:ProgramFiles(x86)} $ProductName
$ProgramDataDir = Join-Path $env:ProgramData $ProductName

Write-Host "=== Uninstalling $ProductName ==="

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Scheduled task removed."
}

Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*MJH-Printer-Agent.exe*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

foreach ($dir in @($InstallDir, $InstallDirX86)) {
  if ($dir -and (Test-Path $dir)) {
    Remove-Item -Recurse -Force $dir
    Write-Host "Removed $dir"
  }
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
