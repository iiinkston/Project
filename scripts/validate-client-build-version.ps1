# Validate Client Setup ProductVersion + app.asar package.json version == ExpectedVersion.
# Usage:
#   .\scripts\validate-client-build-version.ps1 -ExpectedVersion 1.0.13 `
#     -SetupPath "dist\client-build\MJH Printer Setup.exe" `
#     -AsarPath "dist\client-build\win-unpacked\resources\app.asar"

param(
  [Parameter(Mandatory = $true)][string]$ExpectedVersion,
  [Parameter(Mandatory = $true)][string]$SetupPath,
  [string]$UnpackedPackageJson = "",
  [string]$AsarPath = ""
)

$ErrorActionPreference = "Stop"

function Fail([string]$msg) {
  [Console]::Error.WriteLine("CLIENT_BUILD_VERSION_FAIL: $msg")
  exit 1
}

function Normalize-Semver([string]$ver) {
  if (-not $ver) { return "" }
  $v = $ver.Trim()
  if ($v -match '^(\d+\.\d+\.\d+)') { return $Matches[1] }
  return $v
}

if ($ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') {
  Fail "ExpectedVersion='$ExpectedVersion' must be X.Y.Z"
}
if (-not (Test-Path -LiteralPath $SetupPath)) {
  Fail "Setup missing: $SetupPath"
}

$setupFull = (Resolve-Path -LiteralPath $SetupPath).Path
$vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($setupFull)
$productVersion = Normalize-Semver ([string]$vi.ProductVersion)
$fileVersion = Normalize-Semver ([string]$vi.FileVersion)
$setupSemver = if ($productVersion) { $productVersion } else { $fileVersion }
if (-not $setupSemver) { Fail "Setup has empty ProductVersion/FileVersion: $setupFull" }

$pkgVersion = $null
$pkgPathUsed = $null
if ($UnpackedPackageJson -and (Test-Path -LiteralPath $UnpackedPackageJson)) {
  $pkgPathUsed = (Resolve-Path -LiteralPath $UnpackedPackageJson).Path
  $pkg = Get-Content -LiteralPath $pkgPathUsed -Raw -Encoding UTF8 | ConvertFrom-Json
  $pkgVersion = Normalize-Semver ([string]$pkg.version)
}

$asarVersion = $null
$asarUsed = $null
if (-not $AsarPath) {
  $guess = Join-Path (Split-Path -Parent $setupFull) "win-unpacked\resources\app.asar"
  if (Test-Path -LiteralPath $guess) { $AsarPath = $guess }
}
if ($AsarPath) {
  if (-not (Test-Path -LiteralPath $AsarPath)) { Fail "asar missing: $AsarPath" }
  $asarUsed = (Resolve-Path -LiteralPath $AsarPath).Path
  $reader = Join-Path $PSScriptRoot "read-asar-package-version.cjs"
  $asarVersion = (& node $reader $asarUsed).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $asarVersion) {
    Fail "failed to read package.json version from asar: $asarUsed"
  }
  $asarVersion = Normalize-Semver $asarVersion
}

$ok = $true
$reasons = @()
if ($setupSemver -ne $ExpectedVersion) {
  $ok = $false
  $reasons += "Setup ProductVersion='$setupSemver' != expected='$ExpectedVersion'"
}
if ($null -ne $pkgVersion -and $pkgVersion -ne $ExpectedVersion) {
  $ok = $false
  $reasons += "unpacked package.json version='$pkgVersion' != expected='$ExpectedVersion'"
}
if (-not $asarUsed) {
  $ok = $false
  $reasons += "asar path not provided / not found (required for embedded package.json check)"
} elseif ($asarVersion -ne $ExpectedVersion) {
  $ok = $false
  $reasons += "app.asar package.json version='$asarVersion' != expected='$ExpectedVersion'"
}

$result = @{
  ok                 = $ok
  expectedVersion    = $ExpectedVersion
  productVersion     = $productVersion
  fileVersion        = $fileVersion
  packageJsonVersion = $pkgVersion
  asarVersion        = $asarVersion
  setupPath          = $setupFull
  packageJsonPath    = $pkgPathUsed
  asarPath           = $asarUsed
}

if (-not $ok) {
  [Console]::Error.WriteLine("FAIL " + ($reasons -join "; "))
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
  exit 1
}

[Console]::Error.WriteLine("PASS Setup=$setupSemver asar.package.json=$asarVersion (expected=$ExpectedVersion)")
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
exit 0
