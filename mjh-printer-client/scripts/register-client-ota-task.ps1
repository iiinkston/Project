#Requires -RunAsAdministrator
<#
  Register SYSTEM scheduled task for Client OTA Apply.
  Called from NSIS customInstall (elevated).
#>
$ErrorActionPreference = "Continue"
$TaskName = "MJH Printer Client Update"
$ProductName = "MJH Printer Client"
$ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
  $env:ProgramW6432
} else {
  ${env:ProgramFiles}
}
$InstallDir = Join-Path $ProgramFiles64 "MJH Printer"
$UpdaterDir = Join-Path $InstallDir "resources\updater"
$HelperScript = Join-Path $UpdaterDir "apply-client-update-helper.ps1"

# Prefer scripts next to this file when run from package resources
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgHelper = Join-Path $here "apply-client-update-helper.ps1"
if (Test-Path -LiteralPath $pkgHelper) {
  New-Item -ItemType Directory -Force -Path $UpdaterDir | Out-Null
  Copy-Item -Force $pkgHelper $HelperScript
  $updSrc = Join-Path $here "update-client.ps1"
  if (Test-Path -LiteralPath $updSrc) {
    Copy-Item -Force $updSrc (Join-Path $UpdaterDir "update-client.ps1")
  }
  $lifeSrc = Join-Path $here "client-update-lifecycle.ps1"
  if (Test-Path -LiteralPath $lifeSrc) {
    Copy-Item -Force $lifeSrc (Join-Path $UpdaterDir "client-update-lifecycle.ps1")
  }
  $launchSrc = Join-Path $here "launch-client-after-install.ps1"
  if (Test-Path -LiteralPath $launchSrc) {
    Copy-Item -Force $launchSrc (Join-Path $UpdaterDir "launch-client-after-install.ps1")
  }
}

if (-not (Test-Path -LiteralPath $HelperScript)) {
  Write-Warning "apply-client-update-helper.ps1 missing at $HelperScript"
  exit 1
}

$ProgramDataDir = Join-Path $env:ProgramData $ProductName
New-Item -ItemType Directory -Force -Path (Join-Path $ProgramDataDir "updates") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $ProgramDataDir "logs") | Out-Null

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$HelperScript`"" `
  -WorkingDirectory $UpdaterDir
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 45) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $TaskName -Action $action -Settings $settings -Principal $principal -Force | Out-Null

try {
  $svc = New-Object -ComObject "Schedule.Service"
  $svc.Connect()
  $folder = $svc.GetFolder("\")
  $task = $folder.GetTask($TaskName)
  # BA/SY full; Authenticated Users read+execute (schtasks /Run without admin UAC)
  $sddl = "D:AR(A;;FA;;;BA)(A;;FA;;;SY)(A;;0x1200a9;;;AU)"
  $task.SetSecurityDescriptor($sddl, 0)
  Write-Host "Registered elevated Client OTA task: $TaskName"
} catch {
  Write-Warning "Could not set Client OTA task ACL: $($_.Exception.Message)"
}

exit 0
