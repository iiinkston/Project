#Requires -RunAsAdministrator
param()

$ErrorActionPreference = "Stop"

$ProductName = "MJH Printer Agent"
$TaskName = "MJH Printer Agent"
$InstallDir = Join-Path $env:ProgramFiles $ProductName
$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$ConfigDir = Join-Path $ProgramDataDir "config"
$DataDir = Join-Path $ProgramDataDir "data"
$LogsDir = Join-Path $ProgramDataDir "logs"
$ExeName = "MJH-Printer-Agent.exe"

# Locale-independent SIDs
$SidSystem = "S-1-5-18"
$SidAdmins = "S-1-5-32-544"
$SidUsers = "S-1-5-32-545"

function Set-MjhDirectoryAcl {
  param([Parameter(Mandatory = $true)][string]$Path)

  New-Item -ItemType Directory -Force -Path $Path | Out-Null
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)

  $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
             [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  $propagate = [System.Security.AccessControl.PropagationFlags]::None

  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object System.Security.Principal.SecurityIdentifier($SidSystem)),
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inherit, $propagate,
    [System.Security.AccessControl.AccessControlType]::Allow)))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object System.Security.Principal.SecurityIdentifier($SidAdmins)),
    [System.Security.AccessControl.FileSystemRights]::FullControl,
    $inherit, $propagate,
    [System.Security.AccessControl.AccessControlType]::Allow)))
  # Users: ReadAndExecute so Notepad can open files without "Run as administrator".
  # Not Everyone Full Control.
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object System.Security.Principal.SecurityIdentifier($SidUsers)),
    [System.Security.AccessControl.FileSystemRights]::ReadAndExecute,
    $inherit, $propagate,
    [System.Security.AccessControl.AccessControlType]::Allow)))

  Set-Acl -Path $Path -AclObject $acl
}

function Set-MjhConfigFileAcl {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) { return }

  $acl = New-Object System.Security.AccessControl.FileSecurity
  $acl.SetAccessRuleProtection($true, $false)

  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object System.Security.Principal.SecurityIdentifier($SidSystem)),
    [System.Security.AccessControl.FileSystemRights]::Modify,
    [System.Security.AccessControl.AccessControlType]::Allow)))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object System.Security.Principal.SecurityIdentifier($SidAdmins)),
    [System.Security.AccessControl.FileSystemRights]::Modify,
    [System.Security.AccessControl.AccessControlType]::Allow)))
  $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
    (New-Object System.Security.Principal.SecurityIdentifier($SidUsers)),
    [System.Security.AccessControl.FileSystemRights]::Read,
    [System.Security.AccessControl.AccessControlType]::Allow)))

  Set-Acl -Path $Path -AclObject $acl
}

function Test-MjhProgramDataWritable {
  param([Parameter(Mandatory = $true)][string]$DataDir, [Parameter(Mandatory = $true)][string]$LogsDir)

  $probeData = Join-Path $DataDir (".acl-probe-" + [Guid]::NewGuid().ToString("n"))
  $probeLogs = Join-Path $LogsDir (".acl-probe-" + [Guid]::NewGuid().ToString("n"))
  try {
    [System.IO.File]::WriteAllText($probeData, "ok")
    [System.IO.File]::WriteAllText($probeLogs, "ok")
    return $true
  } catch {
    return $false
  } finally {
    Remove-Item -Force $probeData -ErrorAction SilentlyContinue
    Remove-Item -Force $probeLogs -ErrorAction SilentlyContinue
  }
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
# Flat release: install.ps1 sits next to MJH-Printer-Agent.exe
# Legacy nested: scripts\install.ps1 with EXE in parent folder
$PackageRoot = $ScriptRoot
$SourceExe = Join-Path $PackageRoot $ExeName
if (-not (Test-Path $SourceExe)) {
  $parentExe = Join-Path (Split-Path -Parent $ScriptRoot) $ExeName
  if (Test-Path $parentExe) {
    $PackageRoot = Split-Path -Parent $ScriptRoot
    $SourceExe = $parentExe
  } else {
    $SourceExe = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\dist\windows\$ExeName"))
    $PackageRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot ".."))
  }
}

Write-Host "=== Installing $ProductName ==="

if (-not (Test-Path $SourceExe)) {
  throw "EXE not found. Expected at package root or dist/windows."
}

# 1) Stop scheduled task if present (missing task must NOT fail install)
$runningTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($runningTask) {
  Write-Host "Stopping scheduled task..."
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
}

# 2) Stop existing process so EXE can be replaced
Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# 3) Create directories with correct ACL
Write-Host "Creating ProgramData directories and ACL..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Set-MjhDirectoryAcl -Path $ProgramDataDir
Set-MjhDirectoryAcl -Path $ConfigDir
Set-MjhDirectoryAcl -Path $DataDir
Set-MjhDirectoryAcl -Path $LogsDir

if (-not (Test-MjhProgramDataWritable -DataDir $DataDir -LogsDir $LogsDir)) {
  throw "ProgramData directories are not writable by the installer (Administrators). Fix ACL and retry."
}
Write-Host "ACL OK (SYSTEM+Administrators Full; Users Read)."

# 4) Copy EXE only
Copy-Item -Force $SourceExe (Join-Path $InstallDir $ExeName)
Write-Host "EXE installed to $InstallDir"

# 5) Preserve existing ProgramData config (especially agent.token)
$TargetConfig = Join-Path $ConfigDir "printer.json"
if (Test-Path $TargetConfig) {
  try {
    $raw = [System.IO.File]::ReadAllText($TargetConfig)
    if ($raw.Length -gt 0 -and [int][char]$raw[0] -eq 0xFEFF) {
      $raw = $raw.Substring(1)
    }
    $cfg = $raw | ConvertFrom-Json
    if ($null -ne $cfg.agent -and -not [string]::IsNullOrWhiteSpace([string]$cfg.agent.token)) {
      Write-Host "Existing ProgramData config with agent.token preserved (not overwritten)."
    } else {
      Write-Host "Existing ProgramData config preserved (not overwritten)."
    }
  } catch {
    Write-Warning "Existing config could not be parsed; leaving file untouched."
  }
} else {
  $pkgConfig = Join-Path $PackageRoot "config\printer.unbound.json"
  if (-not (Test-Path $pkgConfig)) {
    $pkgConfig = Join-Path $PackageRoot "config\printer.json"
  }
  $devUnbound = "D:\Project\mjh-printer-agent\config\printer.unbound.json"
  $devConfig = "D:\Project\mjh-printer-agent\config\printer.json"
  if (Test-Path $pkgConfig) {
    Copy-Item $pkgConfig $TargetConfig
    Write-Host "Seeded package config to ProgramData (first install)."
  } elseif (Test-Path $devUnbound) {
    Copy-Item $devUnbound $TargetConfig
    Write-Host "Seeded unbound config to ProgramData (first install)."
  } elseif (Test-Path $devConfig) {
    Copy-Item $devConfig $TargetConfig
    Write-Host "Seeded development config to ProgramData (first install)."
  } else {
    Write-Warning "No printer.json found to seed. Create $TargetConfig before starting."
  }
}

Set-MjhConfigFileAcl -Path $TargetConfig

$ExePath = Join-Path $InstallDir $ExeName

Write-Host "Running config:check..."
& $ExePath config:check
if ($LASTEXITCODE -ne 0) {
  Write-Warning "config:check reported issues. Fix ProgramData config before relying on auto-start."
}

# 6) Recreate scheduled task (unregister only if present)
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

$Action = New-ScheduledTaskAction -Execute $ExePath -Argument "agent:start --agent-process" -WorkingDirectory $InstallDir
$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Principal $Principal -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

Write-Host "Running doctor..."
& $ExePath doctor

Write-Host ""
Write-Host "MJH Printer Agent installation complete."
Write-Host "Install dir: $InstallDir"
Write-Host "Config: $TargetConfig"
Write-Host "Logs: $LogsDir"
Write-Host "Permissions: SYSTEM+Administrators Full; Users Read (Notepad OK without elevation)."
Write-Host "Update config safely:"
Write-Host "  $ExePath config:set --store-id <id> --agent-id kitchen-1 --token <token>"
Write-Host "  $ExePath config:show"
Write-Host "  $ExePath config:fix-acl"
Write-Host "Note: upgrade/reinstall never overwrites ProgramData config/data/logs."
