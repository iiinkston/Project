$ErrorActionPreference='Continue'
$out='d:\Project\docs\rc-reports\client-ota-real-upgrade\test5-reboot-result.json'
Start-Sleep 40
schtasks /Run /TN 'MJH Printer Agent' 2>$null | Out-Null
Start-Sleep 10
Start-Process 'C:\Program Files\MJH Printer\MJH Printer Client.exe' -EA SilentlyContinue
Start-Sleep 12
$r=[ordered]@{at=(Get-Date).ToUniversalTime().ToString('o'); client=[bool](Get-Process -Name 'MJH Printer Client' -EA SilentlyContinue); agent=[bool](Get-Process -Name 'MJH-Printer-Agent' -EA SilentlyContinue)}
try { $s=Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 20; $r.agentVersion=$s.version; $r.bound=$s.bound; $r.cloud=$s.cloud.online; $r.printer=$s.printer.online } catch { $r.statusErr=$_.Exception.Message }
$cl=Select-String -Path "$env:APPDATA\MJH Printer Client\logs\client.log" -Pattern 'app start version=' | Select-Object -Last 1
if ($cl) { $r.clientLog=$cl.Line; $r.clientVersion=([regex]::Match($cl.Line,'version=([0-9.]+)')).Groups[1].Value }
$r.pass=[bool]($r.client -and $r.agent -and $r.bound -and $r.clientVersion -eq '1.0.8')
($r|ConvertTo-Json)|Set-Content $out -Encoding utf8
Unregister-ScheduledTask -TaskName 'MJH Client OTA Reboot Validate' -Confirm:$false -EA SilentlyContinue
