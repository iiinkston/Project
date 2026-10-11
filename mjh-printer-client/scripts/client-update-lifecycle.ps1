# Shared Client OTA post-install lifecycle helpers (dot-sourced by update-client.ps1).
# Keep ASCII-only strings for Windows PowerShell 5.1 without BOM.

$script:MjhClientProductName = "MJH Printer Client"
$script:MjhClientExeName = "MJH Printer Client.exe"

function Resolve-MjhClientExeFromDir {
  param([string]$InstallDir)
  if (-not $InstallDir) { return $null }
  foreach ($rel in @(
      $script:MjhClientExeName,
      (Join-Path "MJH Printer Client" $script:MjhClientExeName)
    )) {
    $p = Join-Path $InstallDir $rel
    if (Test-Path -LiteralPath $p) { return $p }
  }
  return $null
}

function Find-MjhClientExeViaRegistry {
  $roots = @(
    "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall",
    "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
      if (-not $p) { return }
      $name = [string]$p.DisplayName
      if ($name -notmatch 'MJH|Printer Client') { return }
      foreach ($field in @([string]$p.DisplayIcon, [string]$p.UninstallString, [string]$p.InstallLocation)) {
        if (-not $field) { continue }
        if ($field -match '"([^"]*MJH Printer Client\.exe)"') {
          $exe = $Matches[1]
          if (Test-Path -LiteralPath $exe) { return $exe }
        }
        if ($field -match '"([^"]*Uninstall[^"]*)"') {
          $dir = Split-Path -Parent $Matches[1]
          $hit = Resolve-MjhClientExeFromDir -InstallDir $dir
          if ($hit) { return $hit }
        }
        $trimmed = ($field -split ',')[0].Trim().Trim('"')
        if ($trimmed -like "*MJH Printer Client.exe" -and (Test-Path -LiteralPath $trimmed)) {
          return $trimmed
        }
        if (Test-Path -LiteralPath $trimmed) {
          $hit = Resolve-MjhClientExeFromDir -InstallDir $trimmed
          if ($hit) { return $hit }
        }
      }
    }
  }
  return $null
}

function Get-MjhClientInstallDir {
  param([string]$PreferredDir = "")
  if ($env:MJH_CLIENT_INSTALL_DIR -and $env:MJH_CLIENT_INSTALL_DIR.Trim().Length -gt 0) {
    return $env:MJH_CLIENT_INSTALL_DIR.Trim()
  }
  if ($PreferredDir -and $PreferredDir.Trim().Length -gt 0) {
    return $PreferredDir.Trim()
  }
  $regExe = Find-MjhClientExeViaRegistry
  if ($regExe) {
    return (Split-Path -Parent $regExe)
  }
  $ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
    $env:ProgramW6432
  } else {
    ${env:ProgramFiles}
  }
  $candidates = @(
    (Join-Path $ProgramFiles64 "MJH Printer"),
    (Join-Path $ProgramFiles64 "MJH Printer Client"),
    (Join-Path $ProgramFiles64 "MJH Printer\MJH Printer Client"),
    "D:\Program Files\MJH Printer",
    "D:\Program Files\MJH Printer Client",
    "D:\Program Files\MJH Printer\MJH Printer Client"
  )
  foreach ($dir in $candidates) {
    if (Resolve-MjhClientExeFromDir -InstallDir $dir) { return $dir }
  }
  return (Join-Path $ProgramFiles64 "MJH Printer")
}

function Get-MjhClientExePath {
  param([string]$InstallDir = "")
  if (-not $InstallDir) { $InstallDir = Get-MjhClientInstallDir }
  $hit = Resolve-MjhClientExeFromDir -InstallDir $InstallDir
  if ($hit) { return $hit }
  # Nested electron-builder layout fallback
  $nested = Resolve-MjhClientExeFromDir -InstallDir (Join-Path $InstallDir "MJH Printer Client")
  if ($nested) { return $nested }
  return (Join-Path $InstallDir $script:MjhClientExeName)
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

  $exeDir = if ($ClientExe) { Split-Path -Parent $ClientExe } else { $InstallDir }

  # 1) Registry DisplayVersion for THIS install (DisplayIcon points at Client EXE)
  if ($ClientExe) {
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
          $icon = [string]$_.DisplayIcon
          $un = [string]$_.UninstallString
          ($icon -and ($icon -like "*$ClientExe*" -or $icon.StartsWith($ClientExe))) -or
          ($un -and $un -like ("*" + (Split-Path -Parent $ClientExe) + "*"))
        } | Select-Object -First 1
        if ($hit -and $hit.DisplayVersion -match '^(\d+\.\d+\.\d+)') {
          return $Matches[1]
        }
      } catch { }
    }
  }

  # 2) asar package.json next to this EXE
  foreach ($asar in @(
      (Join-Path $exeDir "resources\app.asar"),
      (Join-Path $InstallDir "resources\app.asar")
    )) {
    if (-not (Test-Path -LiteralPath $asar)) { continue }
    try {
      $len = (Get-Item -LiteralPath $asar).Length
      $bytes = [System.IO.File]::ReadAllBytes($asar)
      $text = [System.Text.Encoding]::UTF8.GetString($bytes)
      # Tiny stub asar used by unit tests
      if ($len -lt 4096) {
        $m = [regex]::Match(
          $text,
          '"name"\s*:\s*"mjh-printer-client"\s*,\s*"version"\s*:\s*"(\d+\.\d+\.\d+)"'
        )
        if ($m.Success) { return $m.Groups[1].Value }
      }
      # Production asar: highest "version":"x.y.z","private":true
      $found = @([regex]::Matches($text, '"version"\s*:\s*"(\d+\.\d+\.\d+)"\s*,\s*"private"\s*:\s*true') |
        ForEach-Object { $_.Groups[1].Value } |
        Select-Object -Unique)
      if ($found.Count -gt 0) {
        $best = $found[0]
        foreach ($v in $found) {
          $pa = $v.Split('.') | ForEach-Object { [int]$_ }
          $pb = $best.Split('.') | ForEach-Object { [int]$_ }
          for ($i = 0; $i -lt 3; $i++) {
            if ($pa[$i] -gt $pb[$i]) { $best = $v; break }
            if ($pa[$i] -lt $pb[$i]) { break }
          }
        }
        return $best
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

<#
  Wait until installed Client version equals target (files may lag after NSIS exit).
  VersionReader (optional) is for tests: receives attempt number (1-based), returns version string.
#>
function Wait-MjhInstalledClientVersion {
  param(
    [string]$InstallDir = (Get-MjhClientInstallDir),
    [string]$ClientExe = (Get-MjhClientExePath -InstallDir $InstallDir),
    [Parameter(Mandatory = $true)][string]$TargetVersion,
    [int]$RetryCount = 10,
    [int]$RetryIntervalSeconds = 2,
    [scriptblock]$Log = $null,
    [scriptblock]$VersionReader = $null
  )

  if ($TargetVersion -notmatch '^\d+\.\d+\.\d+$') {
    return @{
      ok               = $false
      error            = "INSTALLED_VERSION_MISMATCH"
      detail           = "invalid targetVersion=$TargetVersion"
      installedPath    = $ClientExe
      installedVersion = $null
      attempts         = 0
    }
  }

  if ($Log) {
    & $Log "VERSION_VERIFY_START"
    & $Log ("targetVersion={0}" -f $TargetVersion)
  }

  $lastInstalled = $null
  for ($attempt = 1; $attempt -le $RetryCount; $attempt++) {
    $exeReady = Test-Path -LiteralPath $ClientExe
    if ($VersionReader) {
      $lastInstalled = [string](& $VersionReader $attempt)
    } elseif ($exeReady) {
      $lastInstalled = Get-MjhInstalledClientVersion -InstallDir $InstallDir -ClientExe $ClientExe
    } else {
      $lastInstalled = $null
    }

    $shown = if ($lastInstalled) { $lastInstalled } else { "(unknown)" }
    if ($Log) {
      & $Log "VERSION_VERIFY_ATTEMPT"
      & $Log ("attempt={0}" -f $attempt)
      & $Log ("installedVersion={0}" -f $shown)
    }

    if ($exeReady -and $lastInstalled -and ($lastInstalled -eq $TargetVersion)) {
      if ($Log) {
        & $Log "VERSION_VERIFY_SUCCESS"
        & $Log ("installedVersion={0}" -f $lastInstalled)
      }
      return @{
        ok               = $true
        installedPath    = $ClientExe
        installedVersion = $lastInstalled
        attempts         = $attempt
      }
    }

    if ($attempt -lt $RetryCount) {
      Start-Sleep -Seconds $RetryIntervalSeconds
    }
  }

  if ($Log) {
    & $Log "VERSION_VERIFY_FAILED"
    & $Log ("expected={0}" -f $TargetVersion)
    & $Log ("actual={0}" -f ($(if ($lastInstalled) { $lastInstalled } else { "(unknown)" })))
  }

  return @{
    ok               = $false
    error            = "INSTALLED_VERSION_MISMATCH"
    detail           = ("expected={0} actual={1}" -f $TargetVersion, ($(if ($lastInstalled) { $lastInstalled } else { "(unknown)" })))
    installedPath    = $ClientExe
    installedVersion = $lastInstalled
    attempts         = $RetryCount
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
