$ErrorActionPreference = "Continue"
$report = "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4"
$log = Join-Path $report "fresh-install-run.log"
function L($m){ $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $m; Add-Content $log $line; Write-Host $line }

L "CLEARCONFIG start"
Get-Process -Name "MJH Printer Client","MJH-Printer-Agent" -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep 2
Stop-ScheduledTask -TaskName "MJH Printer Agent" -EA SilentlyContinue
$pd = "C:\ProgramData\MJH Printer Agent"
# wipe all except we remove everything
if (Test-Path $pd) { Remove-Item -LiteralPath $pd -Recurse -Force }
New-Item -ItemType Directory -Force -Path "$pd\config","$pd\data","$pd\logs" | Out-Null
# Minimal unbound printer.json (no token)
$cfg = @{
  store = @{ id = "" }
  agent = @{ id = "kitchen-1"; pollIntervalMs = 3000 }
  printer = @{ name = "Kitchen"; model = "XP-N160II"; ip = "192.168.0.110"; port = 9100; encoding = "gb18030"; connectTimeoutMs = 3000 }
  cloud = @{ baseUrl = "http://206.189.80.83/api/v1" }
} | ConvertTo-Json -Depth 5
Set-Content "$pd\config\printer.json" $cfg -Encoding UTF8
L "ProgramData wiped; unbound config written"

Start-ScheduledTask -TaskName "MJH Printer Agent"
Start-Sleep 5
# ensure agent
if (-not (Get-Process -Name "MJH-Printer-Agent" -EA SilentlyContinue)) {
  Start-Process "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe" -ArgumentList "agent:start","--agent-process" -WorkingDirectory "C:\Program Files\MJH Printer Agent" -WindowStyle Hidden
  Start-Sleep 4
}
L "CLEARCONFIG agent restart done"
