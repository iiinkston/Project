#Requires -RunAsAdministrator
<#
  Register SYSTEM scheduled task for Client OTA Apply.
  Called from NSIS customInstall (elevated).
  Pass -ClientInstallDir "$INSTDIR" so custom install paths work.
#>
param(
  [string]$ClientInstallDir = ""
)
$ErrorActionPreference = "Continue"
$TaskName = "MJH Printer Client Update"
$ProductName = "MJH Printer Client"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
# Packaged layout: <InstallDir>\resources\updater\register-client-ota-task.ps1
$fromPackage = $null
try {
  $resourcesDir = Split-Path -Parent $here
  if ((Split-Path -Leaf $resourcesDir) -eq "resources") {
    $fromPackage = Split-Path -Parent $resourcesDir
  }
} catch { }

if ($ClientInstallDir -and (Test-Path -LiteralPath $ClientInstallDir)) {
  $InstallDir = $ClientInstallDir
} elseif ($fromPackage) {
  $InstallDir = $fromPackage
} else {
  $ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
    $env:ProgramW6432
  } else {
    ${env:ProgramFiles}
  }
  $InstallDir = Join-Path $ProgramFiles64 "MJH Printer"
}

$UpdaterDir = Join-Path $InstallDir "resources\updater"
$HelperScript = Join-Path $UpdaterDir "apply-client-update-helper.ps1"

$pkgHelper = Join-Path $here "apply-client-update-helper.ps1"
if (Test-Path -LiteralPath $pkgHelper) {
  New-Item -ItemType Directory -Force -Path $UpdaterDir | Out-Null
  Copy-Item -Force $pkgHelper $HelperScript
  foreach ($name in @(
    "update-client.ps1",
    "client-update-lifecycle.ps1",
    "launch-client-after-install.ps1"
  )) {
    $src = Join-Path $here $name
    if (Test-Path -LiteralPath $src) {
      Copy-Item -Force $src (Join-Path $UpdaterDir $name)
    }
  }
}

if (-not (Test-Path -LiteralPath $HelperScript)) {
  Write-Warning "apply-client-update-helper.ps1 missing at $HelperScript"
  exit 1
}

Write-Host "Client OTA InstallDir=$InstallDir"
Write-Host "Client OTA Helper=$HelperScript"

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
  $sddl = "D:AR(A;;FA;;;BA)(A;;FA;;;SY)(A;;0x1200a9;;;AU)"
  $task.SetSecurityDescriptor($sddl, 0)
  Write-Host "Registered elevated Client OTA task: $TaskName"
} catch {
  Write-Warning "Could not set Client OTA task ACL: $($_.Exception.Message)"
}

exit 0
