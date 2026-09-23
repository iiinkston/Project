# Validate Client Setup / build ProductVersion matches expected OTA tag version.
# Usage:
#   .\scripts\validate-client-build-version.ps1 -ExpectedVersion 1.0.13 `
#     -SetupPath "dist\client-build\MJH Printer Setup.exe" `
#     -AsarPath "dist\client-build\win-unpacked\resources\app.asar"
#
# Exit 0 = PASS, 1 = FAIL
# stdout: JSON only

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

function Read-AsarAppVersion([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $bytes = [System.IO.File]::ReadAllBytes($Path)
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  $m = [regex]::Match($text, '"name"\s*:\s*"mjh-printer-client"[\s\S]{0,160}"version"\s*:\s*"(\d+\.\d+\.\d+)"')
  if ($m.Success) { return $m.Groups[1].Value }
  $m2 = [regex]::Match($text, '"version"\s*:\s*"(\d+\.\d+\.\d+)"')
  if ($m2.Success) { return $m2.Groups[1].Value }
  return $null
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

$pkgVersion = $null
$pkgPathUsed = $null
$asarVersion = $null
$asarUsed = $null

if ($UnpackedPackageJson -and (Test-Path -LiteralPath $UnpackedPackageJson)) {
  $pkgPathUsed = (Resolve-Path -LiteralPath $UnpackedPackageJson).Path
  $pkg = Get-Content -LiteralPath $pkgPathUsed -Raw -Encoding UTF8 | ConvertFrom-Json
  $pkgVersion = Normalize-Semver ([string]$pkg.version)
}

if (-not $AsarPath) {
  $guess = Join-Path (Split-Path -Parent $setupFull) "win-unpacked\resources\app.asar"
  if (Test-Path -LiteralPath $guess) { $AsarPath = $guess }
}
if ($AsarPath -and (Test-Path -LiteralPath $AsarPath)) {
  $asarUsed = (Resolve-Path -LiteralPath $AsarPath).Path
  $asarVersion = Read-AsarAppVersion $asarUsed
}

$setupSemver = if ($productVersion) { $productVersion } else { $fileVersion }

if (-not $setupSemver) {
  Fail "Setup has empty ProductVersion/FileVersion: $setupFull"
}

$ok = $true
$reasons = @()

if ($setupSemver -ne $ExpectedVersion) {
  $ok = $false
  $reasons += "Setup version='$setupSemver' != expected='$ExpectedVersion'"
}
if ($null -ne $pkgVersion -and $pkgVersion -ne $ExpectedVersion) {
  $ok = $false
  $reasons += "package.json version='$pkgVersion' != expected='$ExpectedVersion'"
}
if ($asarUsed) {
  if (-not $asarVersion) {
    $ok = $false
    $reasons += "could not read asar package.json version from $asarUsed"
  } elseif ($asarVersion -ne $ExpectedVersion) {
    $ok = $false
    $reasons += "asar version='$asarVersion' != expected='$ExpectedVersion'"
  }
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

[Console]::Error.WriteLine("PASS client build version=$setupSemver asar=$asarVersion (expected=$ExpectedVersion)")
[Console]::Out.WriteLine(($result | ConvertTo-Json -Compress))
exit 0
