#Requires -RunAsAdministrator
param(
  [Parameter(Mandatory = $true)]
  [string]$Source
)

# Native EXE stderr must NOT abort the update (old 2.1.1 agent:stop fatals on dynamic import).
$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$InstallDir = Join-Path $env:ProgramFiles $ProductName
$ExePath = Join-Path $InstallDir "MJH-Printer-Agent.exe"
$PreviousPath = Join-Path $InstallDir "MJH-Printer-Agent.previous.exe"
$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$StatusPath = Join-Path $ProgramDataDir "data\status.json"
$LogsDir = Join-Path $ProgramDataDir "logs"
$StartupErrorLog = Join-Path $LogsDir "startup-error.log"

if (-not (Test-Path $Source)) { throw "Source EXE not found: $Source" }
if (-not (Test-Path $ExePath)) { throw "Installed EXE not found: $ExePath" }

function Get-FileSha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -Path $Path).Hash
}

function Get-AgentPids {
  return @(Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}

function Write-StartupErrorLog([string]$Title, [string]$Body) {
  try {
    if (-not (Test-Path $LogsDir)) {
      New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
    }
    $stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    $text = @"
==== $stamp ====
$Title

$Body
"@
    Add-Content -Path $StartupErrorLog -Value $text -Encoding UTF8
    Write-Host "Wrote startup error log: $StartupErrorLog"
  } catch {
    Write-Warning "Could not write startup-error.log: $($_.Exception.Message)"
  }
}

function Invoke-ExeSafe {
  param(
    [string]$Exe,
    [string[]]$Arguments,
    [int]$TimeoutSec = 30
  )
  # Run via cmd so PowerShell does not promote native stderr into terminating errors.
  $argLine = ($Arguments | ForEach-Object {
      if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }) -join ' '
  $cmd = "`"$Exe`" $argLine"
  $outFile = [System.IO.Path]::GetTempFileName()
  $errFile = [System.IO.Path]::GetTempFileName()
  try {
    $p = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $cmd) `
      -Wait -PassThru -NoNewWindow `
      -RedirectStandardOutput $outFile -RedirectStandardError $errFile
    $stdout = ""
    $stderr = ""
    if (Test-Path $outFile) { $stdout = Get-Content -Raw -Path $outFile -ErrorAction SilentlyContinue }
    if (Test-Path $errFile) { $stderr = Get-Content -Raw -Path $errFile -ErrorAction SilentlyContinue }
    return [pscustomobject]@{
      ExitCode = $p.ExitCode
      StdOut   = $stdout
      StdErr   = $stderr
      Combined = (($stdout + "`n" + $stderr).Trim())
    }
  } finally {
    Remove-Item -Force $outFile, $errFile -ErrorAction SilentlyContinue
  }
}

function Stop-AgentHard {
  Write-Host "Stopping scheduled task..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue

  # Prefer new CLI stop, but NEVER abort update if old EXE fatals (dynamic import on 2.1.1).
  if (Test-Path $ExePath) {
    Write-Host "Attempting agent:stop (best-effort)..."
    $stop = Invoke-ExeSafe -Exe $ExePath -Arguments @("agent:stop")
    if ($stop.Combined) {
      Write-Host $stop.Combined
    }
    if ($stop.Combined -match "dynamic import") {
      Write-Warning "Installed EXE agent:stop is broken (old build) — continuing with process kill"
      Write-StartupErrorLog "agent:stop failed (ignored during update)" $stop.Combined
    }
  }

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 400
  }
  Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1

  # Extra pass: taskkill by image (covers SYSTEM/orphans WMI misses)
  cmd /c "taskkill /IM MJH-Printer-Agent.exe /F /T >nul 2>&1"
  Start-Sleep -Seconds 1

  if (Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue) {
    throw "Old MJH-Printer-Agent.exe still running after stop"
  }

  # Clear stale lock that blocks agent:start (SYSTEM/User ACL leftovers).
  $lockPath = Join-Path $ProgramDataDir "data\agent.lock"
  if (Test-Path $lockPath) {
    Write-Host "Clearing stale agent.lock..."
    cmd /c "takeown /F `"$lockPath`" /A >nul 2>&1"
    cmd /c "icacls `"$lockPath`" /grant Administrators:F >nul 2>&1"
    Remove-Item -Force $lockPath -ErrorAction SilentlyContinue
  }
}

Write-Host "=== Updating $ProductName ==="
Write-Host "Rollback only if EXE cannot start / version fails / hash invalid."
Write-Host "Old EXE CLI crashes (e.g. dynamic import on agent:stop) do NOT rollback."

# Never let developer smoke-test env redirect the production update paths.
Remove-Item Env:MJH_PROGRAMDATA_DIR -ErrorAction SilentlyContinue
Remove-Item Env:MJH_CONFIG_PATH -ErrorAction SilentlyContinue
Remove-Item Env:MJH_FORCE_PROGRAMDATA -ErrorAction SilentlyContinue
Remove-Item Env:MJH_DATA_DIR -ErrorAction SilentlyContinue

$sourceHash = Get-FileSha256 $Source
$oldPids = Get-AgentPids
Write-Host ("Pre-update agent PID(s): " + ($(if ($oldPids.Count) { $oldPids -join ", " } else { "(none)" })))

$copied = $false
try {
  Stop-AgentHard

  # Backup + copy
  if (Test-Path $PreviousPath) { Remove-Item -Force $PreviousPath }
  Copy-Item -Force $ExePath $PreviousPath
  Copy-Item -Force $Source $ExePath
  $copied = $true

  $installedHash = Get-FileSha256 $ExePath
  if ($installedHash -ne $sourceHash) {
    throw "Installed EXE hash mismatch after copy"
  }

  $ver = Invoke-ExeSafe -Exe $ExePath -Arguments @("version")
  Write-Host $ver.Combined
  if ($ver.ExitCode -ne 0 -or ($ver.Combined -notmatch "Version:")) {
    Write-StartupErrorLog "version failed after copy" $ver.Combined
    throw "version command failed after update"
  }
  if ($ver.Combined -match "dynamic import") {
    Write-StartupErrorLog "version hit dynamic import" $ver.Combined
    throw "New EXE still has dynamic import failure"
  }

  # Smoke: dry-run must pass before starting the scheduled task
  Write-Host "Running agent:start --dry-run smoke..."
  $dry = Invoke-ExeSafe -Exe $ExePath -Arguments @("agent:start", "--dry-run", "--agent-process")
  Write-Host $dry.Combined
  if ($dry.Combined -match "dynamic import") {
    Write-StartupErrorLog "agent:start --dry-run dynamic import" $dry.Combined
    throw "New EXE agent:start --dry-run failed: dynamic import"
  }
  if ($dry.ExitCode -ne 0 -or ($dry.Combined -notmatch "DRY-RUN PASS")) {
    Write-StartupErrorLog "agent:start --dry-run failed" $dry.Combined
    throw "New EXE agent:start --dry-run failed (exit $($dry.ExitCode))"
  }

  # Start task
  Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 6

  $newPids = Get-AgentPids
  Write-Host ("Post-update agent PID(s): " + ($(if ($newPids.Count) { $newPids -join ", " } else { "(none)" })))

  if ($newPids.Count -eq 0) {
    $diag = @()
    $diag += "No MJH-Printer-Agent process after Start-ScheduledTask"
    if (Test-Path $StatusPath) {
      $diag += "status.json:"
      $diag += (Get-Content -Raw $StatusPath)
    } else {
      $diag += "status.json: MISSING"
    }
    # Short foreground start to capture crash (3s then kill) — never hang the updater
    $tmpOut = [System.IO.Path]::GetTempFileName()
    $tmpErr = [System.IO.Path]::GetTempFileName()
    $proc = Start-Process -FilePath $ExePath -ArgumentList @("agent:start", "--agent-process") `
      -PassThru -NoNewWindow -RedirectStandardOutput $tmpOut -RedirectStandardError $tmpErr
    Start-Sleep -Seconds 3
    if (-not $proc.HasExited) {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
      $diag += "Foreground agent:start stayed alive 3s (task may have failed to launch)"
    } else {
      $diag += "Foreground agent:start exit=$($proc.ExitCode)"
    }
    $diag += "stdout:"; if (Test-Path $tmpOut) { $diag += Get-Content -Raw $tmpOut }
    $diag += "stderr:"; if (Test-Path $tmpErr) { $diag += Get-Content -Raw $tmpErr }
    Remove-Item -Force $tmpOut, $tmpErr -ErrorAction SilentlyContinue
    $body = $diag -join "`n"
    Write-StartupErrorLog "EXE did not stay running after update" $body
    if ($body -match "dynamic import") {
      throw "EXE did not start — dynamic import callback error (see startup-error.log)"
    }
    throw "EXE did not start (no MJH-Printer-Agent process) — see $StartupErrorLog"
  }

  $overlap = @($newPids | Where-Object { $oldPids -contains $_ })
  if ($oldPids.Count -gt 0 -and $overlap.Count -eq $newPids.Count -and $overlap.Count -gt 0) {
    throw "PID did not change after update (still $($overlap -join ', '))"
  }

  if (Test-Path $StatusPath) {
    try {
      $status = Get-Content -Raw -Path $StatusPath | ConvertFrom-Json
      Write-Host ("status.json pid=$($status.pid) version=$($status.version) updatedAt=$($status.updatedAt)")
    } catch {
      Write-Warning "Could not parse status.json (non-fatal)"
    }
  } else {
    Write-Warning "status.json missing after start (non-fatal)"
  }

  Write-Host "Running doctor (warnings only — never triggers rollback)..."
  $doc = Invoke-ExeSafe -Exe $ExePath -Arguments @("doctor")
  Write-Host $doc.Combined
  if ($doc.ExitCode -ne 0) {
    Write-Warning "UPDATE SUCCESS — doctor exit $($doc.ExitCode) (EXE not rolled back)"
  } else {
    Write-Host "UPDATE SUCCESS"
  }
}
catch {
  Write-Host "UPDATE FAILED — $($_.Exception.Message)"
  Write-StartupErrorLog "UPDATE FAILED" $_.Exception.Message
  if ($copied) {
    Write-Host "Rolling back EXE only..."
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    if (Test-Path $PreviousPath) {
      Copy-Item -Force $PreviousPath $ExePath
    }
    Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Write-Host "ROLLED BACK TO PREVIOUS"
  } else {
    Write-Host "Copy never succeeded — no EXE rollback needed"
  }
  throw
}
