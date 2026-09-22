$ErrorActionPreference = "Continue"
$work = "d:\Project\docs\rc-reports\ota-ga"
$log = Join-Path $work "test2-clean-install.log"
function L($m){ Add-Content $log (("[{0}] {1}" -f (Get-Date).ToString("s"), $m)) -Encoding UTF8; Write-Host $m }
L "START clean install"

# Capture ProgramData before
$pd = "C:\ProgramData\MJH Printer Agent"
L "ProgramData exists=$(Test-Path $pd)"
if (Test-Path (Join-Path $pd "config\printer.json")) { L "printer.json PRESERVED marker exists" }

# Stop processes
Get-Process -Name "MJH Printer Client","MJH-Printer-Agent" -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
schtasks /End /TN "MJH Printer Agent" 2>$null
Start-Sleep 2

# Uninstall Client if uninstaller exists
$unin = Get-ChildItem "C:\Program Files\MJH Printer" -Filter "Uninstall*.exe" -EA SilentlyContinue | Select-Object -First 1
if ($unin) {
  L "Uninstall Client $($unin.FullName)"
  Start-Process -FilePath $unin.FullName -ArgumentList "/S" -Wait
} else {
  L "No Client uninstaller — remove Program Files\MJH Printer"
  Remove-Item "C:\Program Files\MJH Printer" -Recurse -Force -EA SilentlyContinue
}

# Uninstall Agent via uninstall.ps1 if present
$au = "C:\Program Files\MJH Printer Agent\uninstall.ps1"
if (Test-Path $au) {
  L "Running Agent uninstall.ps1"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $au *>> $log 2>&1
} else {
  schtasks /Delete /TN "MJH Printer Agent" /F 2>$null
  schtasks /Delete /TN "MJH Printer Agent Update" /F 2>$null
  Remove-Item "C:\Program Files\MJH Printer Agent" -Recurse -Force -EA SilentlyContinue
  L "Removed Agent Program Files"
}

# CRITICAL: do NOT delete ProgramData
if (-not (Test-Path (Join-Path $pd "config\printer.json"))) {
  L "WARN printer.json missing after uninstall"
} else { L "ProgramData config still present PASS" }

Start-Sleep 2
$setup = Join-Path $work "MJH-Printer-Setup-1.0.6-with-2.4.7.exe"
L "Installing Setup /S"
$p = Start-Process -FilePath $setup -ArgumentList "/S" -Wait -PassThru
L "Setup exit=$($p.ExitCode)"
Start-Sleep 8

# Ensure Agent Update task / start
schtasks /Run /TN "MJH Printer Agent" 2>$null
Start-Sleep 6

& "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe" version *>> $log 2>&1
try {
  $s = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 10
  L "status ver=$($s.version) bound=$($s.bound) cloud=$($s.cloud.online) printer=$($s.printer.online) lifecycle=$($s.lifecycle) store=$($s.storeName)"
  ($s | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "test2-status.json") -Encoding utf8
} catch { L "status ERR $($_.Exception.Message)" }

# Start Client
if (Test-Path "C:\Program Files\MJH Printer\MJH Printer Client.exe") {
  Start-Process "C:\Program Files\MJH Printer\MJH Printer Client.exe"
  Start-Sleep 5
  $cp = Get-Process -Name "MJH Printer Client" -EA SilentlyContinue
  L "Client process count=$($cp.Count)"
}
Select-String -Path "$env:APPDATA\MJH Printer Client\logs\client.log" -Pattern "version=" | Select-Object -Last 2 | ForEach-Object { L $_.Line }
L "END"
