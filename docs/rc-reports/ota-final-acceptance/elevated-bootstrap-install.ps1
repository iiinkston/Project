$ErrorActionPreference = 'Continue'
$log = 'd:\Project\docs\rc-reports\ota-final-acceptance\elevated-bootstrap.log'
function L($m){ Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date).ToString('s'), $m) }
L 'START elevated bootstrap'
# Stop client if running
Get-Process -Name 'MJH Printer Client' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2
# Update Agent via update-agent.ps1 if present, else copy
$srcExe = 'D:\Project\docs\rc-reports\ota-final-acceptance\agent-245\MJH-Printer-Agent.exe'
$upd = 'C:\Program Files\MJH Printer Agent\update-agent.ps1'
if (Test-Path $upd) {
  L "Running update-agent.ps1 Source=$srcExe"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $upd -Source $srcExe *>> $log 2>&1
  L "update-agent exit=$LASTEXITCODE"
} else {
  L 'update-agent.ps1 missing — copy EXE'
  Copy-Item -Force $srcExe 'C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe'
}
# Restart scheduled task
schtasks /Run /TN 'MJH Printer Agent' *>> $log 2>&1
Start-Sleep 5
& 'C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe' version *>> $log 2>&1
# Silent install Client Setup (embeds agent too) — /S NSIS
L 'Starting Client Setup /S'
Start-Process -FilePath 'd:\Project\docs\rc-reports\ota-final-acceptance\MJH-Printer-Setup-1.0.5.exe' -ArgumentList '/S' -Wait -PassThru | ForEach-Object { L ("Setup exit=" + $_.ExitCode) }
Start-Sleep 3
if (Test-Path 'C:\Program Files\MJH Printer\MJH Printer Client.exe') { L 'Client EXE present' } else { L 'Client EXE MISSING' }
L 'END'
