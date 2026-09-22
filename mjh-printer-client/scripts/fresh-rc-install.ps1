#Requires -Version 5.1
<#
  Elevated RC fresh-install harness for MJH Printer Desktop.
  Usage (elevated): powershell -File fresh-rc-install.ps1 -Mode KeepConfig|ClearConfig|StaleLock|Capture
#>
param(
  [ValidateSet("Uninstall", "Install", "KeepConfigPrep", "ClearConfigPrep", "StaleLock", "Capture", "All")]
  [string]$Mode = "All",
  [string]$SetupPath = "D:\Project\dist\client-build\MJH Printer Setup.exe",
  [string]$ReportDir = "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4"
)

$ErrorActionPreference = "Continue"
$ProductClient = "MJH Printer"
$ProductAgent = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$ProgramFiles64 = if ($env:ProgramW6432) { $env:ProgramW6432 } else { $env:ProgramFiles }
$ClientDir = Join-Path $ProgramFiles64 $ProductClient
$AgentDir = Join-Path $ProgramFiles64 $ProductAgent
$ProgramDataDir = Join-Path $env:ProgramData $ProductAgent
$LockPath = Join-Path $ProgramDataDir "data\agent.lock"
$LogFile = Join-Path $ReportDir "fresh-install-run.log"

function Write-Log([string]$m) {
  New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $m
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Stop-MjhProcesses {
  Get-Process -Name "MJH Printer Client","MJH-Printer-Agent" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}

function Invoke-Uninstall {
  Write-Log "UNINSTALL start"
  Stop-MjhProcesses
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

  $unins = @(
    (Join-Path $ClientDir "Uninstall MJH Printer Client.exe"),
    (Join-Path $ClientDir "Uninstall MJH Printer Client.exe")
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1

  if ($unins) {
    Write-Log "Running uninstaller $unins"
    $p = Start-Process -FilePath $unins -ArgumentList "/S" -Wait -PassThru
    Write-Log "Uninstaller exit=$($p.ExitCode)"
  }

  # Belt-and-suspenders
  if (Test-Path (Join-Path $AgentDir "uninstall.ps1")) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $AgentDir "uninstall.ps1")
  }
  schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
  if (Test-Path $ClientDir) { Remove-Item -LiteralPath $ClientDir -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $AgentDir) { Remove-Item -LiteralPath $AgentDir -Recurse -Force -ErrorAction SilentlyContinue }
  # Also remove legacy path
  $legacy = "D:\Program Files\MJH Printer Client"
  if (Test-Path $legacy) { Remove-Item -LiteralPath $legacy -Recurse -Force -ErrorAction SilentlyContinue }
  Write-Log "UNINSTALL done clientExists=$(Test-Path $ClientDir) agentExists=$(Test-Path $AgentDir)"
}

function Invoke-Install {
  Write-Log "INSTALL start setup=$SetupPath"
  if (-not (Test-Path -LiteralPath $SetupPath)) { throw "Setup missing: $SetupPath" }
  $p = Start-Process -FilePath $SetupPath -ArgumentList "/S" -Wait -PassThru
  Write-Log "Setup exit=$($p.ExitCode)"
  Start-Sleep -Seconds 5
  Write-Log "INSTALL done clientExists=$(Test-Path $ClientDir) agentExists=$(Test-Path $AgentDir)"
}

function Backup-ProgramData {
  $bak = Join-Path $ReportDir "programdata-backup"
  if (Test-Path $ProgramDataDir) {
    if (Test-Path $bak) { Remove-Item $bak -Recurse -Force -ErrorAction SilentlyContinue }
    Copy-Item -LiteralPath $ProgramDataDir -Destination $bak -Recurse -Force
    Write-Log "ProgramData backed up to $bak"
  }
}

function Clear-ProgramDataKeepStructure {
  Write-Log "CLEAR ProgramData (full wipe)"
  Stop-MjhProcesses
  if (Test-Path $ProgramDataDir) {
    Remove-Item -LiteralPath $ProgramDataDir -Recurse -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType Directory -Force -Path (Join-Path $ProgramDataDir "config"),(Join-Path $ProgramDataDir "data"),(Join-Path $ProgramDataDir "logs") | Out-Null
}

function Save-Screenshot([string]$Name) {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $path = Join-Path $ReportDir "$Name.png"
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  Write-Log "SCREENSHOT $path"
  return $path
}

function Get-AgentHealth {
  try {
    return (Invoke-WebRequest -Uri "http://127.0.0.1:17890/local/health" -UseBasicParsing -TimeoutSec 5).Content
  } catch { return $null }
}

function Get-AgentStatus {
  try {
    return (Invoke-WebRequest -Uri "http://127.0.0.1:17890/local/status" -UseBasicParsing -TimeoutSec 5).Content
  } catch { return $null }
}

function Wait-Agent([int]$Seconds = 30) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    $h = Get-AgentHealth
    if ($h -match 'ok') { return $true }
    Start-Sleep -Seconds 1
  }
  return $false
}

function Start-Client {
  $exe = Join-Path $ClientDir "MJH Printer Client.exe"
  if (-not (Test-Path $exe)) { throw "Client EXE missing: $exe" }
  Start-Process -FilePath $exe | Out-Null
  Start-Sleep -Seconds 4
}

function Invoke-StaleLockTest {
  Write-Log "STALE LOCK test start"
  Stop-MjhProcesses
  Start-Sleep -Seconds 2
  New-Item -ItemType Directory -Force -Path (Split-Path $LockPath) | Out-Null
  $stale = @{
    pid = 99999991
    exePath = "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe"
    createdAt = "2020-01-01T00:00:00.000Z"
    version = "2.4.2"
  } | ConvertTo-Json
  Set-Content -LiteralPath $LockPath -Value $stale -Encoding UTF8
  Write-Log "Wrote stale lock pid=99999991"

  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not (Wait-Agent 25)) {
    # Fallback direct start
    $exe = Join-Path $AgentDir "MJH-Printer-Agent.exe"
    Start-Process -FilePath $exe -ArgumentList "agent:start","--agent-process" -WorkingDirectory $AgentDir -WindowStyle Hidden
    [void](Wait-Agent 20)
  }

  $lockAfter = Get-Content -LiteralPath $LockPath -Raw -ErrorAction SilentlyContinue
  $health = Get-AgentHealth
  $ok = ($health -match 'ok') -and ($lockAfter -match '"pid"') -and ($lockAfter -notmatch '99999991')
  Write-Log "STALE LOCK health=$health"
  Write-Log "STALE LOCK lockAfter=$lockAfter"
  Write-Log "STALE LOCK result=$(if($ok){'PASS'}else{'FAIL'})"
  return $ok
}

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

switch ($Mode) {
  "Uninstall" { Invoke-Uninstall }
  "Install" { Invoke-Install }
  "KeepConfigPrep" { Backup-ProgramData }
  "ClearConfigPrep" { Clear-ProgramDataKeepStructure }
  "StaleLock" { [void](Invoke-StaleLockTest) }
  "Capture" { [void](Save-Screenshot "manual") }
  "All" {
    Backup-ProgramData
    Invoke-Uninstall
    Invoke-Install
    if (-not (Wait-Agent 40)) { Write-Log "WARN agent not up after install" }
    Start-Client
    Start-Sleep -Seconds 3
    [void](Save-Screenshot "01-after-install-desktop")
    $status = Get-AgentStatus
    Set-Content -Path (Join-Path $ReportDir "status-keepconfig.json") -Value $status -Encoding UTF8
    Write-Log "status-keepconfig=$status"
  }
}

Write-Log "MODE $Mode complete"
