$ErrorActionPreference = "Continue"
$work = "d:\Project\docs\rc-reports\ota-final-acceptance"
$log = Join-Path $work "elevated-ota-apply.log"
function L($m){ Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date).ToString("s"), $m) }
L "START OTA apply phase"

# Start local nested manifest (version MUST be 1.0.6 / 2.4.6 numeric for compareVersions)
$port = 18766
$manifestBody = @{
  client = @{
    version = "1.0.6"
    url = "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe"
    sha256 = "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1"
  }
  agent = @{
    version = "2.4.6"
    url = "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Agent-v2.4.6.zip"
    sha256 = "ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d"
  }
} | ConvertTo-Json -Depth 5

# Kill old listener if any
Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | ForEach-Object {
  try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
}

$listenerJob = Start-Job -ScriptBlock {
  param($port,$body)
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add("http://127.0.0.1:$port/")
  $listener.Start()
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    if ($ctx.Request.Url.AbsolutePath -eq "/manifest") {
      $bytes = [Text.Encoding]::UTF8.GetBytes($body)
      $res.StatusCode = 200
      $res.ContentType = "application/json; charset=utf-8"
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
    $res.Close()
  }
} -ArgumentList $port,$manifestBody
Start-Sleep 1
try {
  $m = Invoke-RestMethod "http://127.0.0.1:$port/manifest"
  L ("MANIFEST client=$($m.client.version) agent=$($m.agent.version)")
} catch {
  L ("MANIFEST FAIL $($_.Exception.Message)")
}

# Point update.json (admin can write ProgramData)
$aCfg = "C:\ProgramData\MJH Printer Agent\config\update.json"
$cCfg = Join-Path $env:LOCALAPPDATA "MJH Printer Client\config\update.json"
$cfgObj = @{ enabled = $true; channel = "stable"; manifestUrl = "http://127.0.0.1:$port/manifest"; checkIntervalMinutes = 360 }
$cfgJson = $cfgObj | ConvertTo-Json
[System.IO.File]::WriteAllText($aCfg, $cfgJson, (New-Object System.Text.UTF8Encoding $false))
New-Item -ItemType Directory -Force -Path (Split-Path $cCfg) | Out-Null
[System.IO.File]::WriteAllText($cCfg, $cfgJson, (New-Object System.Text.UTF8Encoding $false))
L "update.json pointed to local manifest"

# Agent check / download / apply via Local API
Start-Sleep 2
try {
  $check = Invoke-RestMethod -Method GET "http://127.0.0.1:17890/local/update/check" -TimeoutSec 30
  ($check | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "agent-check.json") -Encoding utf8
  L ("AGENT CHECK available=$($check.updateAvailable) latest=$($check.latestVersion) current=$($check.currentVersion)")
} catch { L ("AGENT CHECK ERR $($_.Exception.Message)") }

try {
  $dl = Invoke-RestMethod -Method POST "http://127.0.0.1:17890/local/update/download" -TimeoutSec 300
  ($dl | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "agent-download.json") -Encoding utf8
  L ("AGENT DOWNLOAD ok=$($dl.ok) msg=$($dl.message) err=$($dl.error)")
} catch { L ("AGENT DOWNLOAD ERR $($_.Exception.Message)") }

# SHA of staged zip if still present, or staged exe
$updDir = "C:\ProgramData\MJH Printer Agent\updates"
Get-ChildItem $updDir -ErrorAction SilentlyContinue | ForEach-Object { L ("UPDATES $($_.Name) $($_.Length)") }
$stagedExe = Join-Path $updDir "MJH-Printer-Agent.exe"
if (Test-Path $stagedExe) {
  $h = (Get-FileHash $stagedExe -Algorithm SHA256).Hash.ToLowerInvariant()
  L "STAGED_EXE_SHA=$h"
}

# Capture status before apply
$before = Invoke-RestMethod "http://127.0.0.1:17890/local/status" -TimeoutSec 5
($before | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "pre-agent-apply-status.json") -Encoding utf8
L ("PRE APPLY bound=$($before.bound) cloud=$($before.cloud.online) printer=$($before.printer.online) ver=$($before.version)")

try {
  $apply = Invoke-RestMethod -Method POST "http://127.0.0.1:17890/local/update/apply" -TimeoutSec 30
  ($apply | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "agent-apply.json") -Encoding utf8
  L ("AGENT APPLY ok=$($apply.ok) msg=$($apply.message) err=$($apply.error)")
} catch { L ("AGENT APPLY ERR $($_.Exception.Message)") }

# Wait for restart
Start-Sleep 25
try {
  $after = Invoke-RestMethod "http://127.0.0.1:17890/local/status" -TimeoutSec 10
  ($after | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "post-agent-apply-status.json") -Encoding utf8
  L ("POST APPLY ver=$($after.version) bound=$($after.bound) cloud=$($after.cloud.online) printer=$($after.printer.online)")
} catch {
  L ("POST APPLY status fail $($_.Exception.Message) — retry")
  Start-Sleep 15
  try {
    $after2 = Invoke-RestMethod "http://127.0.0.1:17890/local/status" -TimeoutSec 10
    ($after2 | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "post-agent-apply-status.json") -Encoding utf8
    L ("POST APPLY2 ver=$($after2.version) bound=$($after2.bound) cloud=$($after2.cloud.online) printer=$($after2.printer.online)")
  } catch { L ("POST APPLY2 FAIL $($_.Exception.Message)") }
}

& "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe" version *>> $log 2>&1

# Client: download Setup to updates via Bits/WebRequest and run update-client or Setup /S
$setupDestDir = Join-Path $env:LOCALAPPDATA "MJH Printer Client\updates"
New-Item -ItemType Directory -Force -Path $setupDestDir | Out-Null
$setupDest = Join-Path $setupDestDir "MJH Printer Setup.exe"
L "Downloading Client Setup for OTA..."
Invoke-WebRequest -Uri "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe" -OutFile $setupDest -UseBasicParsing
$ch = (Get-FileHash $setupDest -Algorithm SHA256).Hash.ToLowerInvariant()
L "CLIENT_SETUP_SHA=$ch match=$($ch -eq '503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1')"

# Prefer update-client.ps1 if exists
$uc = @(
  "C:\Program Files\MJH Printer\resources\updater\update-client.ps1",
  "C:\Program Files\MJH Printer\updater\update-client.ps1"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($uc -and ($ch -eq "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1")) {
  L "Running update-client.ps1 $uc"
  Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 2
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uc -Source $setupDest *>> $log 2>&1
  L "update-client done exit=$LASTEXITCODE"
} elseif ($ch -eq "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1") {
  L "update-client.ps1 missing — Setup /S"
  Get-Process -Name "MJH Printer Client" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 2
  Start-Process -FilePath $setupDest -ArgumentList "/S" -Wait
  L "Setup /S finished"
} else {
  L "CLIENT SHA FAIL — skip install"
}

Start-Sleep 3

# Print test
try {
  $pt = Invoke-RestMethod -Method POST "http://127.0.0.1:17890/local/printer/test" -TimeoutSec 90
  ($pt | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "printer-test.json") -Encoding utf8
  L ("PRINT ok=$($pt.ok) msg=$($pt.message)")
} catch { L ("PRINT ERR $($_.Exception.Message)") }

# Failure case: bad SHA reject via download of wrong hash using a secondary manifest — skip full; note PENDING if not run
L "SHA-mismatch failure case: PENDING in this elevated script (covered by prior unit tests / optional)"

# Restore update.json to Cloud bootstrap URL (1.0.5) to avoid leaving machine on local manifest
$restore = @{ enabled = $true; channel = "stable"; manifestUrl = "http://206.189.80.83/api/v1/printer/update/latest"; checkIntervalMinutes = 360 } | ConvertTo-Json
[System.IO.File]::WriteAllText($aCfg, $restore, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText($cCfg, $restore, (New-Object System.Text.UTF8Encoding $false))
L "Restored update.json to Cloud URL"

Stop-Job $listenerJob -ErrorAction SilentlyContinue
Remove-Job $listenerJob -Force -ErrorAction SilentlyContinue
L "END"
