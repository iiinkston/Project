$ErrorActionPreference='Continue'
$post = 'd:\Project\docs\rc-reports\ota-ga\post-reboot-validate.ps1'
Unregister-ScheduledTask -TaskName 'MJH OTA GA Reboot Validate' -Confirm:$false -EA SilentlyContinue
$ra = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$post`""
$rt = New-ScheduledTaskTrigger -AtLogOn
$rp = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName 'MJH OTA GA Reboot Validate' -Action $ra -Trigger $rt -Principal $rp -Force | Out-Null
schtasks /Query /TN 'MJH OTA GA Reboot Validate' /FO LIST | Out-File 'd:\Project\docs\rc-reports\ota-ga\reboot-task-verify.txt' -Encoding utf8
Add-Content 'd:\Project\docs\rc-reports\ota-ga\reboot-task-verify.txt' 'REGISTER_OK'
shutdown.exe /r /t 20 /c 'MJH OTA GA Test5 reboot recovery'
