$exe = "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe"
Remove-Item "C:\ProgramData\MJH Printer Agent\data\agent.lock" -Force -EA SilentlyContinue
Start-Process $exe -ArgumentList "agent:start","--agent-process" -WorkingDirectory "C:\Program Files\MJH Printer Agent" -WindowStyle Hidden
Start-Sleep 5
Get-Process MJH-Printer-Agent -EA SilentlyContinue | Select Id | Out-File "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\agent-pid.txt"
try { (Invoke-WebRequest http://127.0.0.1:17890/local/health -UseBasicParsing -TimeoutSec 3).Content | Out-File "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\health.txt" } catch { $_ | Out-File "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\health.txt" }
Get-Content "C:\ProgramData\MJH Printer Agent\logs\agent-2026-09-22.log" -Tail 30 | Out-File "D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\agent-tail.txt"
