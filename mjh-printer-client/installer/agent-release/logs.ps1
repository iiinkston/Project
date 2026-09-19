param(
  [int]$Tail = 100
)

$LogsDir = Join-Path $env:ProgramData "MJH Printer Agent\logs"
if (-not (Test-Path $LogsDir)) {
  Write-Host "No logs directory: $LogsDir"
  exit 0
}

$latest = Get-ChildItem $LogsDir -Filter "agent-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $latest) {
  Write-Host "No log files in $LogsDir"
  exit 0
}

Write-Host "=== $($latest.FullName) (tail $Tail) ==="
Get-Content $latest.FullName -Tail $Tail
