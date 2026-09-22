#Requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$ExePath = Join-Path $env:ProgramFiles "$ProductName\MJH-Printer-Agent.exe"

Write-Host "=== Starting $ProductName ==="
# Ensure no stale agent before start
if (Test-Path $ExePath) {
  & $ExePath agent:stop 2>$null | Out-Null
}
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 3
if (Test-Path $ExePath) {
  & $ExePath agent:status
}
Write-Host "Started $TaskName"
