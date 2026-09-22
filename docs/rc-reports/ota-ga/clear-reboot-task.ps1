$ErrorActionPreference="Continue"
Unregister-ScheduledTask -TaskName "MJH OTA GA Reboot Validate" -Confirm:$false -EA SilentlyContinue
"UNREGISTERED $(Get-Date -Format o)" | Set-Content "d:\Project\docs\rc-reports\ota-ga\reboot-task-cleared.txt" -Encoding utf8
