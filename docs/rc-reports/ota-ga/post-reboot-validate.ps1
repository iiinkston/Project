$ErrorActionPreference = "Continue"
$work = "d:\Project\docs\rc-reports\ota-ga"
$out = Join-Path $work "test5-reboot-result.json"
$log = Join-Path $work "test5-reboot.log"
$report = "d:\Project\docs\ota-ga-production-validation.md"
function L($m){ Add-Content $log (("[{0}] {1}" -f (Get-Date).ToString("s"), $m)) -Encoding UTF8 }

Start-Sleep 50
L "POST REBOOT START"

# Ensure Agent task is running
schtasks /Run /TN "MJH Printer Agent" 2>&1 | Out-Null
Start-Sleep 15
Start-Process "C:\Program Files\MJH Printer\MJH Printer Client.exe" -EA SilentlyContinue
Start-Sleep 10

$agentRunning = [bool](Get-Process -Name "MJH-Printer-Agent" -EA SilentlyContinue)
$clientRunning = [bool](Get-Process -Name "MJH Printer Client" -EA SilentlyContinue)
L "agentProc=$agentRunning clientProc=$clientRunning"

$ver=$null;$bound=$null;$cloud=$null;$printer=$null;$lifecycle=$null;$store=$null
$clientVer = $null
try {
  $s = Invoke-RestMethod http://127.0.0.1:17890/local/status -TimeoutSec 25
  $ver=$s.version; $bound=$s.bound; $cloud=$s.cloud.online; $printer=$s.printer.online
  $lifecycle=$s.lifecycle; $store=$s.storeName
  L "status ver=$ver bound=$bound cloud=$cloud printer=$printer lifecycle=$lifecycle store=$store"
} catch { L "status ERR $($_.Exception.Message)" }

try {
  $cl = Select-String -Path "$env:APPDATA\MJH Printer Client\logs\client.log" -Pattern "app start version=" | Select-Object -Last 1
  if ($cl) { $clientVer = ([regex]::Match($cl.Line, "version=([0-9.]+)")).Groups[1].Value; L "clientLog $($cl.Line)" }
} catch { L "clientLog ERR $($_.Exception.Message)" }

$printOk = $false; $printMsg = $null
try {
  $pt = Invoke-RestMethod -Method POST http://127.0.0.1:17890/local/printer/test -TimeoutSec 90
  $printOk = [bool]$pt.ok; $printMsg = $pt.message
  L "PRINT ok=$printOk msg=$printMsg"
} catch { L "PRINT ERR $($_.Exception.Message)" }

$pass = [bool]($agentRunning -and ($ver -eq "2.4.8") -and $bound -and $cloud -and $printer -and ($clientVer -eq "1.0.7"))
$result = [ordered]@{
  at = (Get-Date).ToUniversalTime().ToString("o")
  agentProcess = $agentRunning
  clientProcess = $clientRunning
  agentVersion = $ver
  clientVersion = $clientVer
  bound = $bound
  cloudOnline = $cloud
  printerOnline = $printer
  lifecycle = $lifecycle
  storeName = $store
  printOk = $printOk
  printMessage = $printMsg
  pass = $pass
}
($result | ConvertTo-Json) | Set-Content $out -Encoding utf8
L "WROTE $out pass=$pass"

$t5 = if ($pass) { "PASS" } else { "FAIL" }
$verdict = if ($pass) { "NOT READY" } else { "NOT READY" }
$verdictReason = @"
- Agent Local API Apply 在本轮返回 ``ok`` + ``mode=direct (elevated)``，但 35s 内 status 仍为 2.4.7，脚本随后 **force ``update-agent.ps1``** 才稳定到 2.4.8；门店纯 UI/LocalAPI 无强制路径的 Apply 闭环 **未单独证明**。
- 生产 Cloud Manifest 仍为 Bootstrap **1.0.5 / 2.4.5**；本轮 Agent/Client OTA 使用本机 ``127.0.0.1:18767/manifest``。
- 验收机为开发机（含 Git/Node/Cursor），不满足洁净门店机约束。
- Cloud 正式 PrintJob PENDING→CLAIMED→PRINTED 未测。
"@

$md = @"
# MJH Printer OTA GA Production Validation

**Date (UTC):** 2026-09-22  
**Final Decision:** **$verdict**

禁止假设 PASS：凡未真实执行的步骤均标 **PENDING**。证据目录：``docs/rc-reports/ota-ga/``。

---

## Environment

| Item | Value |
|------|-------|
| Windows | Windows 11 10.0.26200 (x64) |
| Machine | DESKTOP-1N2OP3S |
| Role | 开发机（非洁净门店机） |
| Printer | XP-N160II ``192.168.0.110:9100`` |
| GA target tag | ``v1.0.7-ga-test`` |
| Client target | **1.0.7** SHA ``984051e7512f2332cf2f2dae67a9d547366817a9541bbfd502ebcdea89c62ef1`` |
| Agent target | **2.4.8** SHA ``e3c18b15f81590a26eb09835dd18f49bb2d887c34d3fded830c05f2cfed44208`` |

---

## Before (clean reinstall baseline)

| Component | Version / state |
|-----------|-----------------|
| Client | **1.0.6**（Setup silent install + ``client.log``） |
| Agent | **2.4.7**（``/local/status``） |
| Binding | ``bound=true``, store=``Man Jiang Hong``, cloud/printer online |
| ProgramData | printer.json **PRESERVED** across uninstall/reinstall |

证据：用户粘贴 clean-install 日志；``test2-status.json``。

---

## After (post OTA + reboot)

| Component | Version / state |
|-----------|-----------------|
| Client | **$clientVer**（``client.log``） |
| Agent | **$ver**（``/local/status``） |
| Binding | bound=$bound cloud=$cloud printer=$printer lifecycle=$lifecycle store=$store |
| Reboot recovery | **$t5**（``test5-reboot-result.json``） |
| Print after reboot | ok=$printOk msg=$printMsg |

---

## Test Matrix

| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Cloud/Release SHA | **PASS*** | *生产 Cloud 声明 1.0.5/2.4.5 与下载物 SHA **一致**（``test1-cloud-sha.json``）。GA 目标 1.0.7/2.4.8 的 Release SHA 已核对（``release-sha256-1.0.7.txt``）；**生产 Cloud 未切到 GA 目标**。 |
| 2 | Clean reinstall | **PASS** | Uninstall→ProgramData 保留→Setup /S exit=0→Agent 2.4.7 + Client 1.0.6 + bound/cloud/printer |
| 3 | Agent OTA 2.4.7→2.4.8 | **PASS*** | check/download/SHA/stage **PASS**。LocalAPI apply 记 ``mode=direct (elevated)`` 且返回 ok；35s 内 status 仍 2.4.7 → elevated 脚本 **force update-agent** 后 **2.4.8** + binding 保持。SYSTEM 任务 ``MJH Printer Agent Update`` LastResult=267011（未跑）。 |
| 4 | Client OTA 1.0.6→1.0.7 | **PASS** | Setup SHA match；``update-client.ps1 -SetupPath`` exit=0；日志 ``version=1.0.7``；打印测试 ok |
| 5 | Reboot recovery | **$t5** | 真实 ``shutdown /r`` 后 AtLogOn 校验；agent=$agentRunning client=$clientRunning ver=$ver client=$clientVer |

---

## Cloud Manifest

生产 ``GET http://206.189.80.83/api/v1/printer/update/latest`` 本轮仍为：

- client ``1.0.5`` / sha ``38a215f6…``
- agent ``2.4.5`` / sha ``5783fe1d…``

GA OTA 使用本地 Manifest（``http://127.0.0.1:18767/manifest`` → 1.0.7 / 2.4.8）。**未改 Cloud API 代码。**

---

## Final Decision

是否达到「门店安装一次 Setup 后，可长期远程 OTA 维护」：

**$verdict**

理由：

$verdictReason

### 已证明

- Clean reinstall 保留 ProgramData 绑定，基线 **Client 1.0.6 + Agent 2.4.7** 可恢复。
- Agent **2.4.7→2.4.8**（elevated force 路径）与 Client **1.0.6→1.0.7** 真实升级成功，绑定/云/打印机保持。
- 升级后本地打印测试 **PASS**。
- 重启后恢复：**$t5**。

### 门店 GA 前最小缺口

1. 洁净机复测：仅 LocalAPI/UI Apply（禁止测试脚本 force ``update-agent``）。
2. 运维将生产 Manifest 临时切到 ``v1.0.7-ga-test``（version 字段用 ``1.0.7``/``2.4.8``）。
3. 一笔真实 Cloud PrintJob PENDING→CLAIMED→PRINTED。
4. 确认非 elevated Agent 进程下 Apply 返回 ``ELEVATION_REQUIRED`` 且 SYSTEM 任务真正跑通。
"@

[IO.File]::WriteAllText($report, $md, (New-Object Text.UTF8Encoding $true))
L "WROTE $report verdict=$verdict t5=$t5"

Unregister-ScheduledTask -TaskName "MJH OTA GA Reboot Validate" -Confirm:$false -EA SilentlyContinue
L "END"
