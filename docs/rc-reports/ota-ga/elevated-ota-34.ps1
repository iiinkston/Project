$ErrorActionPreference = "Continue"
$work = "d:\Project\docs\rc-reports\ota-ga"
$log = Join-Path $work "test34-ota.log"
function L($m){ Add-Content $log (("[{0}] {1}" -f (Get-Date).ToString("s"), $m)) -Encoding UTF8 }

$clientSha = "984051e7512f2332cf2f2dae67a9d547366817a9541bbfd502ebcdea89c62ef1"
$agentSha = "e3c18b15f81590a26eb09835dd18f49bb2d887c34d3fded830c05f2cfed44208"
$port = 18767
$body = (@{
  client = @{ version = "1.0.7"; url = "https://github.com/iiinkston/Project/releases/download/v1.0.7-ga-test/MJH-Printer-Setup.exe"; sha256 = $clientSha }
  agent = @{ version = "2.4.8"; url = "https://github.com/iiinkston/Project/releases/download/v1.0.7-ga-test/MJH-Printer-Agent-v2.4.8.zip"; sha256 = $agentSha }
} | ConvertTo-Json -Depth 5)

Get-NetTCPConnection -LocalPort $port -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue }
$job = Start-Job -ScriptBlock {
  param($port,$body)
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://127.0.0.1:$port/")
  $l.Start()
  while ($l.IsListening) {
    $c = $l.GetContext(); $r = $c.Response
    if ($c.Request.Url.AbsolutePath -eq "/manifest") {
      $b = [Text.Encoding]::UTF8.GetBytes($body)
      $r.StatusCode = 200; $r.ContentType = "application/json"
      $r.OutputStream.Write($b,0,$b.Length)
    } else { $r.StatusCode = 404 }
    $r.Close()
  }
} -ArgumentList $port,$body
Start-Sleep 1
$m = Invoke-RestMethod "http://127.0.0.1:$port/manifest"
L "MANIFEST client=$($m.client.version) agent=$($m.agent.version)"

$aCfg = "C:\ProgramData\MJH Printer Agent\config\update.json"
$cCfg = Join-Path $env:LOCALAPPDATA "MJH Printer Client\config\update.json"
$cfg = (@{ enabled=$true; channel="stable"; manifestUrl="http://127.0.0.1:$port/manifest"; checkIntervalMinutes=60 } | ConvertTo-Json)
[IO.File]::WriteAllText($aCfg, $cfg, (New-Object Text.UTF8Encoding $false))
New-Item -ItemType Directory -Force -Path (Split-Path $cCfg) | Out-Null
[IO.File]::WriteAllText($cCfg, $cfg, (New-Object Text.UTF8Encoding $false))
L "update.json -> local manifest"

$helper = "C:\Program Files\MJH Printer Agent\apply-update-helper.ps1"
$updPs1 = "C:\Program Files\MJH Printer Agent\update-agent.ps1"
if ((Test-Path $helper) -and (Test-Path $updPs1)) {
  $tn = "MJH Printer Agent Update"
  Unregister-ScheduledTask -TaskName $tn -Confirm:$false -EA SilentlyContinue
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$helper`"" -WorkingDirectory "C:\Program Files\MJH Printer Agent"
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
  Register-ScheduledTask -TaskName $tn -Action $action -Settings $settings -Principal $principal -Force | Out-Null
  try {
    $svc = New-Object -ComObject Schedule.Service; $svc.Connect()
    $task = $svc.GetFolder("\").GetTask($tn)
    $task.SetSecurityDescriptor("D:AR(A;;FA;;;BA)(A;;FA;;;SY)(A;;0x1200a9;;;AU)", 0)
    L "Registered $tn"
  } catch { L "ACL warn $($_.Exception.Message)" }
} else { L "helper/update-agent missing" }

Start-Sleep 2
$check = Invoke-RestMethod http://127.0.0.1:17890/local/update/check -TimeoutSec 30
L "AGENT CHECK current=$($check.currentVersion) latest=$($check.latestVersion) available=$($check.updateAvailable)"
($check | ConvertTo-Json) | Set-Content (Join-Path $work "test3-agent-check.json") -Encoding utf8

$dl = Invoke-RestMethod -Method POST http://127.0.0.1:17890/local/update/download -TimeoutSec 300
L "AGENT DOWNLOAD ok=$($dl.ok) msg=$($dl.message) err=$($dl.error) code=$($dl.code)"
($dl | ConvertTo-Json) | Set-Content (Join-Path $work "test3-agent-download.json") -Encoding utf8

$staged = "C:\ProgramData\MJH Printer Agent\updates\MJH-Printer-Agent.exe"
if (Test-Path $staged) { L "STAGED exists size=$((Get-Item $staged).Length)" }

$apply = Invoke-RestMethod -Method POST http://127.0.0.1:17890/local/update/apply -TimeoutSec 30
L "AGENT APPLY ok=$($apply.ok) code=$($apply.code) elevationStarted=$($apply.elevationStarted) err=$($apply.error) msg=$($apply.message)"
($apply | ConvertTo-Json) | Set-Content (Join-Path $work "test3-agent-apply.json") -Encoding utf8

if ($apply.ok -ne $true -and -not $apply.elevationStarted) {
  L "Apply did not start — direct elevated update-agent"
  if ((Test-Path $staged) -and (Test-Path $updPs1)) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updPs1 -Source $staged *>> $log 2>&1
  }
} else {
  L "Waiting for agent restart..."
}
Start-Sleep 35
try {
  $s = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 15
  L "POST AGENT ver=$($s.version) bound=$($s.bound) cloud=$($s.cloud.online) printer=$($s.printer.online)"
  ($s | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "test3-post-agent-status.json") -Encoding utf8
} catch {
  L "status fail $($_.Exception.Message) retry"
  Start-Sleep 15
  if ((Test-Path $staged) -and (Test-Path $updPs1)) {
    L "Force elevated update-agent"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updPs1 -Source $staged *>> $log 2>&1
    Start-Sleep 20
  }
  try {
    $s2 = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 15
    L "POST AGENT2 ver=$($s2.version) bound=$($s2.bound) cloud=$($s2.cloud.online) printer=$($s2.printer.online)"
    ($s2 | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "test3-post-agent-status.json") -Encoding utf8
  } catch { L "POST AGENT2 FAIL $($_.Exception.Message)" }
}

# If still not 2.4.8, force apply
try {
  $cur = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 10
  if ($cur.version -ne "2.4.8" -and (Test-Path $staged) -and (Test-Path $updPs1)) {
    L "Still $($cur.version) — force update-agent"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $updPs1 -Source $staged *>> $log 2>&1
    Start-Sleep 25
    $cur = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 10
    L "AFTER FORCE ver=$($cur.version) bound=$($cur.bound) cloud=$($cur.cloud.online) printer=$($cur.printer.online)"
    ($cur | ConvertTo-Json -Depth 6) | Set-Content (Join-Path $work "test3-post-agent-status.json") -Encoding utf8
  }
} catch { L "force check err $($_.Exception.Message)" }

& "C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe" version *>> $log 2>&1

# Client OTA
$setupDir = Join-Path $env:LOCALAPPDATA "MJH Printer Client\updates"
New-Item -ItemType Directory -Force -Path $setupDir | Out-Null
$setup = Join-Path $setupDir "MJH Printer Setup.exe"
L "Downloading Client 1.0.7..."
Invoke-WebRequest "https://github.com/iiinkston/Project/releases/download/v1.0.7-ga-test/MJH-Printer-Setup.exe" -OutFile $setup -UseBasicParsing
$ch = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
L "CLIENT SHA=$ch match=$($ch -eq $clientSha)"
$uc = "C:\Program Files\MJH Printer\resources\updater\update-client.ps1"
Get-Process -Name "MJH Printer Client" -EA SilentlyContinue | Stop-Process -Force -EA SilentlyContinue
Start-Sleep 2
if (($ch -eq $clientSha) -and (Test-Path $uc)) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $uc -SetupPath $setup *>> $log 2>&1
  L "client update exit=$LASTEXITCODE"
} else { L "CLIENT SHA or update-client missing — skip" }
Start-Sleep 4
Start-Process "C:\Program Files\MJH Printer\MJH Printer Client.exe" -EA SilentlyContinue
Start-Sleep 5
Select-String -Path "$env:APPDATA\MJH Printer Client\logs\client.log" -Pattern "version=" | Select-Object -Last 3 | ForEach-Object { L $_.Line }

try {
  $pt = Invoke-RestMethod -Method POST http://127.0.0.1:17890/local/printer/test -TimeoutSec 90
  L "PRINT ok=$($pt.ok) msg=$($pt.message)"
  ($pt | ConvertTo-Json) | Set-Content (Join-Path $work "test34-print.json") -Encoding utf8
} catch { L "PRINT ERR $($_.Exception.Message)" }

$restore = (@{ enabled=$true; channel="stable"; manifestUrl="http://206.189.80.83/api/v1/printer/update/latest"; checkIntervalMinutes=360 } | ConvertTo-Json)
[IO.File]::WriteAllText($aCfg, $restore, (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText($cCfg, $restore, (New-Object Text.UTF8Encoding $false))
L "Restored Cloud manifestUrl"

# Write post-reboot script as separate file (already on disk if present)
$post = Join-Path $work "post-reboot-validate.ps1"
Unregister-ScheduledTask -TaskName "MJH OTA GA Reboot Validate" -Confirm:$false -EA SilentlyContinue
$ra = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$post`""
$rt = New-ScheduledTaskTrigger -AtLogOn
$rp = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName "MJH OTA GA Reboot Validate" -Action $ra -Trigger $rt -Principal $rp -Force | Out-Null
L "Registered reboot validation task"

Stop-Job $job -EA SilentlyContinue
Remove-Job $job -Force -EA SilentlyContinue
L "END — reboot NOT auto-triggered (parent will schedule separately)"
