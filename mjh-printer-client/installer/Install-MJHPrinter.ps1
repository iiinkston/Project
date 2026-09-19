#Requires -RunAsAdministrator
<#
.SYNOPSIS
  MJH Printer Platform installer (Agent + Client) without Inno Setup.
  Produces the same layout as MJH-Printer-Setup.exe would.
#>
param(
  [string]$AgentRelease = "",
  [string]$ClientUnpacked = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $AgentRelease) { $AgentRelease = Join-Path $Root "mjh-printer-agent\release" }
if (-not $ClientUnpacked) { $ClientUnpacked = Join-Path $Root "mjh-printer-client\release\win-unpacked" }

$ClientInstall = Join-Path $env:ProgramFiles "MJH Printer\client"
$UpdaterInstall = Join-Path $env:ProgramFiles "MJH Printer\updater"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ClientExeName = "MJH Printer Client.exe"

Write-Host "=== MJH Printer Platform Setup ==="
Write-Host "Agent package: $AgentRelease"
Write-Host "Client package: $ClientUnpacked"

if (-not (Test-Path (Join-Path $AgentRelease "MJH-Printer-Agent.exe"))) {
  throw "Agent EXE missing in $AgentRelease"
}
if (-not (Test-Path (Join-Path $ClientUnpacked $ClientExeName))) {
  throw "Client EXE missing in $ClientUnpacked"
}

# 1) Agent via existing install.ps1 (preserves ProgramData)
Write-Host "`n[1/4] Installing Printer Agent..."
Push-Location $AgentRelease
try {
  & ".\install.ps1"
} finally {
  Pop-Location
}

# 2) Client
Write-Host "`n[2/4] Installing Printer Client..."
New-Item -ItemType Directory -Force -Path $ClientInstall | Out-Null
Copy-Item -Path (Join-Path $ClientUnpacked "*") -Destination $ClientInstall -Recurse -Force

# 3) Updater bundle
Write-Host "`n[3/4] Installing updater scripts..."
New-Item -ItemType Directory -Force -Path $UpdaterInstall | Out-Null
Copy-Item (Join-Path $AgentRelease "update-agent.ps1") $UpdaterInstall -Force
Copy-Item (Join-Path $AgentRelease "MJH-Printer-Agent.exe") $UpdaterInstall -Force

# 4) Desktop shortcut
Write-Host "`n[4/4] Creating shortcuts..."
$Wsh = New-Object -ComObject WScript.Shell
$lnk = $Wsh.CreateShortcut((Join-Path $Desktop "满江红打印助手.lnk"))
$lnk.TargetPath = Join-Path $ClientInstall $ClientExeName
$lnk.WorkingDirectory = $ClientInstall
$lnk.Description = "满江红打印助手"
$lnk.Save()

# Autostart tray (HKCU)
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
New-ItemProperty -Path $runKey -Name "MJHPrinterClient" -PropertyType String `
  -Value ("`"{0}`" --tray" -f (Join-Path $ClientInstall $ClientExeName)) -Force | Out-Null

Write-Host "`nLaunching Client..."
Start-Process -FilePath (Join-Path $ClientInstall $ClientExeName)

Write-Host ""
Write-Host "=== Setup complete ==="
Write-Host "Agent:  C:\Program Files\MJH Printer Agent\"
Write-Host "Client: $ClientInstall"
Write-Host "Data:   C:\ProgramData\MJH Printer Agent\"
Write-Host "Shortcut: Desktop\满江红打印助手"
