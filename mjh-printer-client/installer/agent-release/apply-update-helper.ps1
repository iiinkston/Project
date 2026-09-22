#Requires -RunAsAdministrator
<#
  Runs as SYSTEM via scheduled task "MJH Printer Agent Update".
  Reads ProgramData\updates\apply-request.json then invokes update-agent.ps1 -Source.
#>
$ErrorActionPreference = "Continue"
$ProductName = "MJH Printer Agent"
$ProgramDataDir = Join-Path $env:ProgramData $ProductName
$UpdatesDir = Join-Path $ProgramDataDir "updates"
$RequestPath = Join-Path $UpdatesDir "apply-request.json"
$LogDir = Join-Path $ProgramDataDir "logs"
$LogPath = Join-Path $LogDir "ota-apply-helper.log"

function Write-HelperLog([string]$Message) {
  try {
    if (-not (Test-Path $LogDir)) {
      New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    }
    $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $Message
    Add-Content -Path $LogPath -Value $line -Encoding UTF8
  } catch {
    # ignore
  }
  Write-Host $Message
}

Write-HelperLog "APPLY HELPER START"

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

$source = [string]$req.source
$script = [string]$req.script
if (-not $source -or -not (Test-Path -LiteralPath $source)) {
  Write-HelperLog "ERROR: source EXE missing: $source"
  exit 4
}

$ProgramFiles64 = if ($env:ProgramW6432 -and $env:ProgramW6432.Trim().Length -gt 0) {
  $env:ProgramW6432
} else {
  ${env:ProgramFiles}
}
$InstallDir = Join-Path $ProgramFiles64 $ProductName
if (-not $script -or -not (Test-Path -LiteralPath $script)) {
  $script = Join-Path $InstallDir "update-agent.ps1"
}
if (-not (Test-Path -LiteralPath $script)) {
  Write-HelperLog "ERROR: update-agent.ps1 missing: $script"
  exit 5
}

Write-HelperLog "Running update-agent.ps1 Source=$source"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -Source $source
$code = $LASTEXITCODE
Write-HelperLog "update-agent.ps1 exit=$code"
try {
  Remove-Item -LiteralPath $RequestPath -Force -ErrorAction SilentlyContinue
} catch {
  # ignore
}
exit $code
