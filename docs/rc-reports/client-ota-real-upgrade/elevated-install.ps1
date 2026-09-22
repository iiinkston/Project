$ErrorActionPreference='Continue'
$log = 'd:\Project\docs\rc-reports\client-ota-real-upgrade\elevated-install.log'
function L($m){ Add-Content $log ((Get-Date).ToString('s') + ' ' + $m) -Encoding UTF8; Write-Host $m }
L 'ELEVATED INSTALL START'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'd:\Project\mjh-printer-client\scripts\update-client.ps1' -SetupPath 'C:\Users\XU MING WEI\AppData\Local\MJH Printer Client\updates\MJH Printer Setup.exe' -OldVersion '1.0.7' -NewVersion '1.0.8' *>> $log 2>&1
L ("update-client exit=" + $LASTEXITCODE)
# Register task if missing (NSIS should have done this)
$reg = 'd:\Project\mjh-printer-client\scripts\register-client-ota-task.ps1'
if (Test-Path $reg) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $reg *>> $log 2>&1; L 'register-task done' }
$u = Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -EA SilentlyContinue | Where-Object { $_.DisplayName -match 'MJH Printer Client' } | Select-Object -First 1 DisplayName,DisplayVersion
L ("registry=" + ($u | ConvertTo-Json -Compress))
schtasks /Query /TN 'MJH Printer Client Update' /FO LIST | Out-File 'd:\Project\docs\rc-reports\client-ota-real-upgrade\task-after-install.txt' -Encoding utf8
'INSTALL_PHASE_DONE' | Set-Content 'd:\Project\docs\rc-reports\client-ota-real-upgrade\install-phase.flag' -Encoding utf8
