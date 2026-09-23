#Requires -RunAsAdministrator
<#
  Runs as SYSTEM via scheduled task "MJH Printer Client Update".
  Reads ProgramData\MJH Printer Client\updates\apply-request.json
  then invokes update-client.ps1 -SetupPath.
#>
$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Client"
$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$UpdatesDir = Join-Path $ProgramDataDir "updates"
$RequestPath = Join-Path $UpdatesDir "apply-request.json"
$LogDir = Join-Path $ProgramDataDir "logs"
$LogPath = Join-Path $LogDir "client-apply-helper.log"

function Write-HelperLog([string]$Message) {
  try {
    if (-not (Test-Path -LiteralPath $LogDir)) {
      New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    }
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
  } catch {
    # ignore
  }
  Write-Host $Message
}

Write-HelperLog "CLIENT APPLY HELPER START"

if (-not (Test-Path -LiteralPath $RequestPath)) {
  Write-HelperLog "ERROR: apply-request.json missing: $RequestPath"
  exit 2
}

try {
  $raw = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8
  $req = $raw | ConvertFrom-Json
} catch {
  Write-HelperLog "ERROR: invalid apply-request.json: $($_.Exception.Message)"
  exit 3
}

$setupPath = [string]$req.setupPath
if (-not $setupPath) { $setupPath = [string]$req.source }
$script = [string]$req.script
$oldVersion = [string]$req.oldVersion
$newVersion = [string]$req.newVersion
$expectedSha256 = [string]$req.expectedSha256
if (-not $expectedSha256) { $expectedSha256 = [string]$req.sha256 }

if (-not $setupPath -or -not (Test-Path -LiteralPath $setupPath)) {
  Write-HelperLog "ERROR: Setup missing: $setupPath"
  exit 4
}

$ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
  $env:ProgramW6432
} else {
  ${env:ProgramFiles}
}
$UpdaterDir = Join-Path $ProgramFiles64 "MJH Printer\resources\updater"
if (-not $script -or -not (Test-Path -LiteralPath $script)) {
  $script = Join-Path $UpdaterDir "update-client.ps1"
}
if (-not (Test-Path -LiteralPath $script)) {
  Write-HelperLog "ERROR: update-client.ps1 missing: $script"
  exit 5
}

# Ensure lifecycle helper sits next to update-client.ps1 (dot-source)
$lifeName = "client-update-lifecycle.ps1"
$lifeDst = Join-Path (Split-Path -Parent $script) $lifeName
$lifeSrcCandidates = @(
  (Join-Path $UpdaterDir $lifeName),
  (Join-Path $PSScriptRoot $lifeName)
)
if (-not (Test-Path -LiteralPath $lifeDst)) {
  foreach ($c in $lifeSrcCandidates) {
    if ($c -and (Test-Path -LiteralPath $c)) {
      Copy-Item -Force $c $lifeDst
      break
    }
  }
}

Write-HelperLog "Running update-client.ps1 SetupPath=$setupPath old=$oldVersion new=$newVersion sha=$expectedSha256"
$argList = @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $script,
  "-SetupPath", $setupPath
)
if ($oldVersion) { $argList += @("-OldVersion", $oldVersion) }
if ($newVersion) { $argList += @("-NewVersion", $newVersion) }
if ($expectedSha256) { $argList += @("-ExpectedSha256", $expectedSha256) }

& powershell.exe @argList
$code = $LASTEXITCODE
Write-HelperLog "update-client.ps1 exit=$code"
try {
  Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue
} catch {
  # ignore
}
exit $code
