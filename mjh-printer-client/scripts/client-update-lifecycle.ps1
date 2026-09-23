# Shared Client OTA post-install lifecycle helpers (dot-sourced by update-client.ps1).
# Keep ASCII-only strings for Windows PowerShell 5.1 without BOM.

$script:MjhClientProductName = "MJH Printer Client"

function Get-MjhClientInstallDir {
  $ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
    $env:ProgramW6432
  } else {
    ${env:ProgramFiles}
  }
  return (Join-Path $ProgramFiles64 "MJH Printer")
}

function Get-MjhClientExePath {
  param([string]$InstallDir = (Get-MjhClientInstallDir))
  return (Join-Path $InstallDir "MJH Printer Client.exe")
}

function Test-MjhRunningAsSystem {
  try {
    return [bool]([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem)
  } catch {
    return $false
  }
}

function Get-MjhInteractiveUserId {
  try {
    $exp = Get-CimInstance Win32_Process -Filter "Name = 'explorer.exe'" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($exp) {
      $owner = Invoke-CimMethod -InputObject $exp -MethodName GetOwner -ErrorAction SilentlyContinue
      if ($owner -and $owner.ReturnValue -eq 0 -and $owner.User) {
        if ($owner.Domain) { return ("{0}\{1}" -f $owner.Domain, $owner.User) }
        return [string]$owner.User
      }
    }
  } catch { }
  try {
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    if ($cs -and $cs.UserName) { return [string]$cs.UserName }
  } catch { }
  return $null
}

function Get-MjhInstalledClientVersion {
  param(
    [string]$InstallDir = (Get-MjhClientInstallDir),
    [string]$ClientExe = (Get-MjhClientExePath -InstallDir $InstallDir)
  )

  # 1) asar embedded package.json (matches Electron app.getVersion / OTA truth)
  $asar = Join-Path $InstallDir "resources\app.asar"
  if (Test-Path -LiteralPath $asar) {
    try {
      $bytes = [System.IO.File]::ReadAllBytes($asar)
      $text = [System.Text.Encoding]::UTF8.GetString($bytes)
      $m = [regex]::Match($text, '"name"\s*:\s*"mjh-printer-client"[\s\S]{0,160}"version"\s*:\s*"(\d+\.\d+\.\d+)"')
      if ($m.Success) { return $m.Groups[1].Value }
      $m2 = [regex]::Match($text, '"version"\s*:\s*"(\d+\.\d+\.\d+)"')
      if ($m2.Success) { return $m2.Groups[1].Value }
    } catch { }
  }

  # 2) Uninstall registry DisplayVersion (electron-builder) as fallback
  $roots = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    try {
      $hit = Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
        Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      } | Where-Object {
        $_.DisplayName -and ($_.DisplayName -like "*MJH Printer Client*")
      } | Select-Object -First 1
      if ($hit -and $hit.DisplayVersion) {
        $dv = [string]$hit.DisplayVersion
        if ($dv -match '^(\d+\.\d+\.\d+)') { return $Matches[1] }
        return $dv.Trim()
      }
    } catch { }
  }

  return $null
}

function Stop-MjhSession0ClientProcesses {
  param([scriptblock]$Log = $null)
  Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue |
    Where-Object { $_.SessionId -eq 0 } |
    ForEach-Object {
      if ($Log) { & $Log ("Stopping Session0 Client pid={0}" -f $_.Id) }
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}

function Start-MjhClientInteractive {
  param(
    [Parameter(Mandatory = $true)][string]$ClientExe,
    [scriptblock]$Log = $null,
    [string]$LaunchTaskName = "MJH Printer Client Launch Once",
    [int]$SettleSeconds = 3
  )

  if (-not (Test-Path -LiteralPath $ClientExe)) {
    return @{
      ok    = $false
      mode  = "missing-exe"
      error = "Client EXE missing: $ClientExe"
      pid   = $null
      path  = $ClientExe
    }
  }

  Stop-MjhSession0ClientProcesses -Log $Log

  if (-not (Test-MjhRunningAsSystem)) {
    try {
      $p = Start-Process -FilePath $ClientExe -PassThru -ErrorAction Stop
    } catch {
      return @{
        ok    = $false
        mode  = "direct"
        error = "Start-Process failed: $($_.Exception.Message)"
        pid   = $null
        path  = $ClientExe
      }
    }
    Start-Sleep -Seconds $SettleSeconds
    $alive = Get-Process -Id $p.Id -ErrorAction SilentlyContinue
    if (-not $alive) {
      return @{
        ok    = $false
        mode  = "direct"
        error = "Client exited immediately after launch"
        pid   = $p.Id
        path  = $ClientExe
      }
    }
    if ($Log) { & $Log ("LAUNCH_OK mode=direct pid={0} path={1}" -f $p.Id, $ClientExe) }
    return @{
      ok   = $true
      mode = "direct"
      pid  = [int]$p.Id
      path = $ClientExe
    }
  }

  # SYSTEM task context: must launch into interactive user session (not Session 0).
  $user = Get-MjhInteractiveUserId
  if (-not $user) {
    return @{
      ok    = $false
      mode  = "system-no-user"
      error = "No interactive user session for Client launch"
      pid   = $null
      path  = $ClientExe
    }
  }
  if ($Log) { & $Log ("LAUNCH_USER user=$user") }

  Unregister-ScheduledTask -TaskName $LaunchTaskName -Confirm:$false -ErrorAction SilentlyContinue
  try {
    $action = New-ScheduledTaskAction -Execute $ClientExe
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
      -MultipleInstances IgnoreNew
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $trigger = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddYears(-1))
    Register-ScheduledTask `
      -TaskName $LaunchTaskName `
      -Action $action `
      -Settings $settings `
      -Principal $principal `
      -Trigger $trigger `
      -Force | Out-Null
    Start-ScheduledTask -TaskName $LaunchTaskName -ErrorAction Stop
  } catch {
    Unregister-ScheduledTask -TaskName $LaunchTaskName -Confirm:$false -ErrorAction SilentlyContinue
    return @{
      ok    = $false
      mode  = "interactive-task"
      error = "Failed to start interactive launch task: $($_.Exception.Message)"
      pid   = $null
      path  = $ClientExe
      user  = $user
    }
  }

  Start-Sleep -Seconds $SettleSeconds
  $alive = @(Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue |
      Where-Object { $_.SessionId -ne 0 })
  Unregister-ScheduledTask -TaskName $LaunchTaskName -Confirm:$false -ErrorAction SilentlyContinue

  if ($alive.Count -eq 0) {
    return @{
      ok    = $false
      mode  = "interactive-task"
      error = "No interactive-session Client process after launch task"
      pid   = $null
      path  = $ClientExe
      user  = $user
    }
  }

  $launchPid = [int]$alive[0].Id
  if ($Log) { & $Log ("LAUNCH_OK mode=interactive-task pid={0} session={1} user={2} path={3}" -f $launchPid, $alive[0].SessionId, $user, $ClientExe) }
  return @{
    ok   = $true
    mode = "interactive-task"
    pid  = $launchPid
    path = $ClientExe
    user = $user
  }
}

function Assert-MjhClientInstalled {
  param(
    [string]$InstallDir = (Get-MjhClientInstallDir),
    [string]$ClientExe = (Get-MjhClientExePath -InstallDir $InstallDir),
    [string]$TargetVersion = "",
    [scriptblock]$Log = $null
  )

  if (-not (Test-Path -LiteralPath $ClientExe)) {
    if ($Log) { & $Log ("ERROR installed path missing: {0}" -f $ClientExe) }
    return @{
      ok               = $false
      error            = "Client EXE missing after setup: $ClientExe"
      installedPath    = $ClientExe
      installedVersion = $null
    }
  }

  $installedVersion = Get-MjhInstalledClientVersion -InstallDir $InstallDir -ClientExe $ClientExe
  if ($Log) {
    & $Log ("installedPath={0}" -f $ClientExe)
    & $Log ("installedVersion={0}" -f ($(if ($installedVersion) { $installedVersion } else { "(unknown)" })))
  }

  if ($TargetVersion -and $TargetVersion -match '^\d+\.\d+\.\d+$') {
    if (-not $installedVersion) {
      return @{
        ok               = $false
        error            = "Could not read installed version after setup (target=$TargetVersion)"
        installedPath    = $ClientExe
        installedVersion = $null
      }
    }
    if ($installedVersion -ne $TargetVersion) {
      return @{
        ok               = $false
        error            = "Installed version '$installedVersion' != target '$TargetVersion'"
        installedPath    = $ClientExe
        installedVersion = $installedVersion
      }
    }
  }

  return @{
    ok               = $true
    installedPath    = $ClientExe
    installedVersion = $installedVersion
  }
}

function Get-MjhRestartRequestPath {
  param([string]$ProgramDataDir = (Join-Path $env:ProgramData $script:MjhClientProductName))
  return (Join-Path $ProgramDataDir "updates\restart-request.json")
}

function Write-MjhRestartRequest {
  param(
    [Parameter(Mandatory = $true)][string]$ClientExe,
    [string]$OldVersion = "",
    [string]$TargetVersion = "",
    [string]$InstalledVersion = "",
    [string]$ProgramDataDir = (Join-Path $env:ProgramData $script:MjhClientProductName)
  )
  $path = Get-MjhRestartRequestPath -ProgramDataDir $ProgramDataDir
  $dir = Split-Path -Parent $path
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }
  $obj = [ordered]@{
    clientExe         = $ClientExe
    oldVersion        = $OldVersion
    targetVersion     = $TargetVersion
    installedVersion  = $InstalledVersion
    requestedAt       = (Get-Date).ToUniversalTime().ToString("o")
    forbidSessionZero = $true
  }
  [System.IO.File]::WriteAllText(
    $path,
    (($obj | ConvertTo-Json -Compress) + "`n"),
    (New-Object System.Text.UTF8Encoding $false)
  )
  return $path
}

<#
  After successful install: never Start-Process Client from SYSTEM (Session 0).
  Writes restart-request.json then launches into interactive user session.
#>
function Invoke-MjhUserSessionRestart {
  param(
    [Parameter(Mandatory = $true)][string]$ClientExe,
    [string]$OldVersion = "",
    [string]$TargetVersion = "",
    [string]$InstalledVersion = "",
    [string]$ProgramDataDir = (Join-Path $env:ProgramData $script:MjhClientProductName),
    [scriptblock]$Log = $null,
    [int]$SettleSeconds = 3
  )

  # Close any leftover Client (including Session 0) before restart.
  Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
  Stop-MjhSession0ClientProcesses -Log $Log

  $reqPath = Write-MjhRestartRequest `
    -ClientExe $ClientExe `
    -OldVersion $OldVersion `
    -TargetVersion $TargetVersion `
    -InstalledVersion $InstalledVersion `
    -ProgramDataDir $ProgramDataDir
  if ($Log) { & $Log ("restartRequest={0}" -f $reqPath) }

  $asSystem = Test-MjhRunningAsSystem
  if ($asSystem) {
    if ($Log) { & $Log "launchMethod=user-session-task (SYSTEM must not Start-Process Electron)" }
    $launch = Start-MjhClientInteractive -ClientExe $ClientExe -Log $Log -SettleSeconds $SettleSeconds
    $launchMethod = "user-session-task"
  } else {
    if ($Log) { & $Log "launchMethod=direct (already interactive user)" }
    $launch = Start-MjhClientInteractive -ClientExe $ClientExe -Log $Log -SettleSeconds $SettleSeconds
    $launchMethod = if ($launch.mode) { [string]$launch.mode } else { "direct" }
  }

  # Clear request on success
  if ($launch.ok) {
    try { Remove-Item -LiteralPath $reqPath -Force -ErrorAction SilentlyContinue } catch { }
  }

  return @{
    ok               = [bool]$launch.ok
    launchMethod     = $launchMethod
    launchResult     = $(if ($launch.ok) { "PASS" } else { "FAIL" })
    error            = $launch.error
    pid              = $launch.pid
    path             = $ClientExe
    sessionSafe      = (-not $asSystem) -or ($launch.mode -eq "interactive-task")
    restartRequest   = $reqPath
    mode             = $launch.mode
  }
}
