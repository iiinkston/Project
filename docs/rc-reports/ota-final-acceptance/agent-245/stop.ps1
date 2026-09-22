#Requires -RunAsAdministrator
$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$ExePath = Join-Path $env:ProgramFiles "$ProductName\MJH-Printer-Agent.exe"

Write-Host "=== Stopping $ProductName ==="
Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

if (Test-Path $ExePath) {
  & $ExePath agent:stop
} else {
  Write-Warning "EXE not found at $ExePath — killing by image name only"
  Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Wait up to 10s for exit
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
  $alive = Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue
  if (-not $alive) { break }
  Start-Sleep -Milliseconds 400
}
Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Write-Host "Stopped $TaskName"
