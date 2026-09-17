# Safe local starter for MJH Printer Agent.
# Does not store, hardcode, or print the API token.

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not $env:MJH_PRINTER_AGENT_TOKEN -or -not $env:MJH_PRINTER_AGENT_TOKEN.Trim()) {
  Write-Host "Missing MJH_PRINTER_AGENT_TOKEN."
  Write-Host 'Set it in this PowerShell session first, for example:'
  Write-Host '$env:MJH_PRINTER_AGENT_TOKEN = "<paste-new-token-locally>"'
  exit 1
}

$configPath = Join-Path (Get-Location) "config\printer.json"
$config = Get-Content -Raw -Path $configPath | ConvertFrom-Json

Write-Host "[MJH] Starting with:"
Write-Host ("[MJH] Store: {0}" -f $config.store.id)
Write-Host ("[MJH] Agent: {0}" -f $config.agent.id)
Write-Host ("[MJH] Printer: {0} @ {1}:{2}" -f $config.printer.model, $config.printer.ip, $config.printer.port)
Write-Host ("[MJH] Cloud: {0}" -f $config.cloud.baseUrl)
Write-Host "[MJH] Token: (set in environment, value not shown)"

pnpm agent:start
