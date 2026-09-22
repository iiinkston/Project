#Requires -Version 5.1
# Elevated recovery: clear stale lock, restore scheduled task, start ProgramData Agent.
$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$ProgramFiles64 = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$InstallDir = Join-Path $ProgramFiles64 $ProductName
$ExePath = Join-Path $InstallDir "MJH-Printer-Agent.exe"
$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$LockPath = Join-Path $ProgramDataDir "data\agent.lock"
$LogPath = Join-Path $ProgramDataDir "logs\recover-elevated.log"

function Write-Log([string]$m) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $m
  Add-Content -Path $LogPath -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
  Write-Host $line
}

New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null
Write-Log "RECOVER START"

# Stop any running agents (including temporary recover instance)
Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

if (Test-Path -LiteralPath $LockPath) {
  Remove-Item -LiteralPath $LockPath -Force
  Write-Log "Removed stale agent.lock"
}

if (-not (Test-Path -LiteralPath $ExePath)) {
  Write-Log "ERROR missing exe $ExePath"
  exit 1
}

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Log "Unregistered old task"
}

$Action = New-ScheduledTaskAction -Execute $ExePath -Argument "agent:start --agent-process" -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null
Write-Log "Registered scheduled task"

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

$proc = Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue
if ($proc) {
  Write-Log ("Agent running PID=" + ($proc.Id -join ","))
} else {
  Write-Log "WARN: no process after Start-ScheduledTask — trying direct start"
  Start-Process -FilePath $ExePath -ArgumentList "agent:start","--agent-process" -WorkingDirectory $InstallDir -WindowStyle Hidden
  Start-Sleep -Seconds 4
}

try {
  $h = Invoke-WebRequest -Uri "http://127.0.0.1:17890/local/health" -UseBasicParsing -TimeoutSec 5
  Write-Log ("health " + $h.Content)
} catch {
  Write-Log ("health FAIL " + $_.Exception.Message)
}

Write-Log "RECOVER DONE"
