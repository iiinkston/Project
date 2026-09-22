Unregister-ScheduledTask -TaskName 'MJH Client OTA Reboot Validate' -Confirm:$false -EA SilentlyContinue
$a=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File "d:\Project\docs\rc-reports\client-ota-real-upgrade\post-reboot-validate.ps1"'
$t=New-ScheduledTaskTrigger -AtLogOn
$p=New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName 'MJH Client OTA Reboot Validate' -Action $a -Trigger $t -Principal $p -Force | Out-Null
'TASK_OK' | Set-Content 'd:\Project\docs\rc-reports\client-ota-real-upgrade\reboot-task.txt'
shutdown.exe /r /t 25 /c 'MJH Client OTA reboot recovery validation'
