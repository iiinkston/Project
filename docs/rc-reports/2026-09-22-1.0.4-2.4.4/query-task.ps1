$t = Get-ScheduledTask -TaskName "MJH Printer Agent" -ErrorAction SilentlyContinue
if ($t) {
  $info = Get-ScheduledTaskInfo -TaskName "MJH Printer Agent"
  @{ exists=$true; state=[string]$t.State; lastResult=$info.LastTaskResult; lastRun=$info.LastRunTime } | ConvertTo-Json
} else {
  '{"exists":false}'
}
