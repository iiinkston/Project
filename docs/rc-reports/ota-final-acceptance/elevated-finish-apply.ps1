$ErrorActionPreference = 'Continue'
$log = 'd:\Project\docs\rc-reports\ota-final-acceptance\elevated-finish-apply.log'
function L($m){ Add-Content $log (("[{0}] {1}" -f (Get-Date).ToString('s'), $m)) -Encoding UTF8 }
L 'START finish apply'
if (Test-Path 'C:\ProgramData\MJH Printer Agent\updates\MJH-Printer-Agent.exe') {
  L 'Agent update-agent.ps1 with staged 2.4.6'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Program Files\MJH Printer Agent\update-agent.ps1' -Source 'C:\ProgramData\MJH Printer Agent\updates\MJH-Printer-Agent.exe' *>> $log 2>&1
  L ("agent update exit=" + $LASTEXITCODE)
} else { L 'STAGED MISSING' }
Start-Sleep 8
& 'C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe' version *>> $log 2>&1
try {
  $s = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 10
  L ("status ver=$($s.version) bound=$($s.bound) cloud=$($s.cloud.online) printer=$($s.printer.online)")
  ($s | ConvertTo-Json -Depth 6) | Set-Content 'd:\Project\docs\rc-reports\ota-final-acceptance\final-status-after-agent-apply.json' -Encoding utf8
} catch { L ("status err " + $_.Exception.Message) }

L 'Client update-client.ps1 -SetupPath'
Get-Process -Name 'MJH Printer Client' -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep 2
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Program Files\MJH Printer\resources\updater\update-client.ps1' -SetupPath 'C:\Users\XU MING WEI\AppData\Local\MJH Printer Client\updates\MJH Printer Setup.exe' *>> $log 2>&1
L ("client update exit=" + $LASTEXITCODE)
Start-Sleep 3
# Start client briefly? optional
if (Test-Path 'C:\Program Files\MJH Printer\MJH Printer Client.exe') {
  Start-Process 'C:\Program Files\MJH Printer\MJH Printer Client.exe'
  Start-Sleep 5
}
Select-String -Path $env:APPDATA\MJH*\logs\client.log -Pattern 'version=' -EA SilentlyContinue | Select-Object -Last 3 | ForEach-Object { L $_.Line }
try {
  $pt = Invoke-RestMethod -Method POST http://127.0.0.1:17890/local/printer/test -TimeoutSec 90
  L ("PRINT ok=$($pt.ok) msg=$($pt.message)")
  ($pt | ConvertTo-Json) | Set-Content 'd:\Project\docs\rc-reports\ota-final-acceptance\final-printer-test.json' -Encoding utf8
} catch { L ("PRINT err " + $_.Exception.Message) }
L 'END'
