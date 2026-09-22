# Lightweight PowerShell syntax check for OTA release scripts (Windows PowerShell 5.1 / powershell.exe).
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\check-ps1-syntax.ps1

param(
  [string]$Path = ""
)

$ErrorActionPreference = "Stop"

if (-not $Path) {
  $Path = Join-Path $PSScriptRoot "validate-release-versions.ps1"
}

$errors = $null
$tokens = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$errors)

if ($errors -and $errors.Count -gt 0) {
  foreach ($err in $errors) {
    [Console]::Error.WriteLine(("SYNTAX_FAIL {0}:{1} {2}" -f $err.Extent.StartLineNumber, $err.Extent.StartColumnNumber, $err.Message))
  }
  exit 1
}

Write-Host "SYNTAX_OK $Path"
exit 0
