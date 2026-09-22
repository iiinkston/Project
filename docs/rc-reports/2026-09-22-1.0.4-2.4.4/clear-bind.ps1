$ErrorActionPreference = "Continue"
$report = "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4"
$log = Join-Path $report "fresh-install-run.log"
function L([string]$m) {
  $line = "{0} {1}" -f (Get-Date).ToUniversalTime().ToString("o"), $m
  Add-Content $log $line
  Write-Host $line
}

Get-Process -Name "MJH-Printer-Agent","MJH Printer Client" -ErrorAction SilentlyContinue |
  Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
Remove-Item "C:\ProgramData\MJH Printer Agent\data\agent.lock" -Force -ErrorAction SilentlyContinue

$cfgPath = "C:\ProgramData\MJH Printer Agent\config\printer.json"
$cfg = @{
  store = @{ id = "unbound"; name = "" }
  agent = @{ id = "kitchen-1"; pollIntervalMs = 3000 }
  printer = @{
    name = "Kitchen"
    model = "XP-N160II"
    ip = "192.168.0.110"
    port = 9100
    encoding = "gb18030"
    connectTimeoutMs = 3000
  }
  cloud = @{ baseUrl = "http://206.189.80.83/api/v1" }
} | ConvertTo-Json -Depth 6
Set-Content -LiteralPath $cfgPath -Value $cfg -Encoding UTF8
L "Wrote valid unbound printer.json"

Start-ScheduledTask -TaskName "MJH Printer Agent" -ErrorAction SilentlyContinue
Start-Sleep 3
if (-not (Get-Process -Name "MJH-Printer-Agent" -ErrorAction SilentlyContinue)) {
  Start-Process "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe" `
    -ArgumentList "agent:start","--agent-process" `
    -WorkingDirectory "C:\Program Files\MJH Printer Agent" `
    -WindowStyle Hidden
}

$ok = $false
for ($i = 0; $i -lt 25; $i++) {
  try {
    $h = (Invoke-WebRequest "http://127.0.0.1:17890/local/health" -UseBasicParsing -TimeoutSec 2).Content
    if ($h -match "ok") { $ok = $true; break }
  } catch {}
  Start-Sleep 1
}
L "Agent up=$ok"
if (-not $ok) {
  Get-Content "C:\ProgramData\MJH Printer Agent\logs\agent-2026-09-22.log" -Tail 20 -ErrorAction SilentlyContinue |
    ForEach-Object { L $_ }
  exit 1
}

$st = (Invoke-WebRequest "http://127.0.0.1:17890/local/status" -UseBasicParsing).Content
Set-Content (Join-Path $report "status-cleared-unbound.json") $st -Encoding UTF8
L "status=$st"

try {
  $bind = Invoke-WebRequest "http://127.0.0.1:17890/local/bind" -Method POST `
    -Body '{"code":"MJH-001"}' -ContentType "application/json" `
    -UseBasicParsing -TimeoutSec 90
  Set-Content (Join-Path $report "bind-MJH-001.json") $bind.Content -Encoding UTF8
  L "BIND OK $($bind.Content)"
} catch {
  $err = $_.ErrorDetails.Message
  if (-not $err) { $err = $_.Exception.Message }
  Set-Content (Join-Path $report "bind-MJH-001.json") $err -Encoding UTF8
  L "BIND FAIL $err"
}

$final = $null
for ($i = 0; $i -lt 40; $i++) {
  $final = (Invoke-WebRequest "http://127.0.0.1:17890/local/status" -UseBasicParsing).Content | ConvertFrom-Json
  if ($final.bound -and $final.cloud.online -and $final.printer.online) { break }
  Start-Sleep 1
}
$finalJson = $final | ConvertTo-Json -Depth 6
Set-Content (Join-Path $report "status-after-bind.json") $finalJson -Encoding UTF8
L "FINAL bound=$($final.bound) cloud=$($final.cloud.online) printer=$($final.printer.online) lifecycle=$($final.lifecycle) store=$($final.storeName)"
