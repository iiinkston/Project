$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$InstallDir = Join-Path $env:ProgramFiles $ProductName
$ExePath = Join-Path $InstallDir "MJH-Printer-Agent.exe"
$StatusPath = Join-Path $env:ProgramData "$ProductName\data\status.json"
$LockPath = Join-Path $env:ProgramData "$ProductName\data\agent.lock"

Write-Host "=== $ProductName status ==="

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $info = Get-ScheduledTaskInfo -TaskName $TaskName
  Write-Host "Task: $($task.State) / LastResult=$($info.LastTaskResult)"
} catch {
  Write-Host "Task: NOT REGISTERED"
}

if (Test-Path $ExePath) {
  Write-Host "EXE: $ExePath"
  & $ExePath version
} else {
  Write-Host "EXE: missing"
}

if (Test-Path $LockPath) {
  Write-Host "Lock: $LockPath"
  Get-Content $LockPath
} else {
  Write-Host "Lock: none"
}

if (Test-Path $StatusPath) {
  Write-Host "Status:"
  Get-Content $StatusPath
} else {
  Write-Host "Status: none"
}
