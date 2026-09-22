# Client OTA Validation

**Date:** 2026-09-22  
**Goal:** 1.0.7 → 1.0.8 真实用户环境闭环  
**Code changes:** 无（仅构建/执行/取证）

---

## Environment

| Item | Value |
|------|-------|
| Machine | DESKTOP-1N2OP3S |
| Windows user | `desktop-1n2op3s\xu ming wei` |
| IsAdmin | **False**（普通用户） |
| Before Client | **1.0.7**（HKLM Uninstall + `client.log`） |
| Before Agent | **2.4.8** bound=true printer=true |
| `MJH Printer Client Update` task (before) | **不存在** |
| Installed 1.0.7 asar 含 Apply 修复 | **False**（无 `ELEVATION_REQUIRED`） |
| Cloud manifest | client **1.0.8** / agent 2.4.8（`GET …/update/latest`） |
| Staged Setup (Cloud SHA) | `7b2a5cae…19be4e` match |
| Validation Setup | **本地构建含 Apply 修复**的 1.0.8 Setup SHA `66ec885a…0a8c66a5`（GitHub Release 1.0.8 **不含**本次修复） |

证据目录：`docs/rc-reports/client-ota-real-upgrade/`

---

## Test Cases

### 1. 普通用户首次升级（无 Client Update Task）

| 检查项 | 结果 |
|--------|------|
| 非管理员 | PASS |
| 无 `MJH Printer Client Update` | PASS（升级前） |
| Apply API 形状 `ok:false code=ELEVATION_REQUIRED elevationStarted=true` | **PASS*** |

\*已装 **1.0.7 二进制无新 Apply 代码**，无法用 UI 旧版验证新 API。使用与产品相同的修复模块做真实非管理员 Invoke（`run-apply-harness.cjs`）：

```json
{
  "ok": false,
  "code": "ELEVATION_REQUIRED",
  "elevationStarted": true,
  "mode": "uac-runas",
  "quitting": true
}
```

`expectedShape=true`（见 `test1-apply-result.json`）。  
`schtasks /Run` 对缺失任务返回 false → 走 **UAC fallback**（符合场景 1→2）。

安装完成后任务已注册（见 Test 3）。

### 2. UAC fallback

| 检查项 | 结果 |
|--------|------|
| Task 不可用时 mode=`uac-runas` | PASS |
| `installer-start.log` | PASS — `CLIENT_APPLY_LAUNCH` + `CLIENT_APPLY_MODE uac-runas` |
| 用户批准 UAC 后完成安装 | PASS（elevated `update-client.ps1`） |

### 3. 安装结果

| 检查项 | 结果 |
|--------|------|
| `update-client.ps1` exitCode | **0** |
| HKLM Uninstall DisplayVersion | **1.0.8** |
| `client.log` | `app start version=1.0.8` @ 14:40:08Z |
| ProgramData `client-update.log` | 含 START / oldVersion=1.0.7 / newVersion=1.0.8 / exitCode=0 / DONE |
| `MJH Printer Client Update` 任务 | **已注册**（Ready） |
| 安装后 asar 含 `ELEVATION_REQUIRED` | **True** |

### 4. 重启恢复

| 检查项 | 结果 |
|--------|------|
| 安装后进程立即恢复 | Client 多进程在跑；Agent 2.4.8 在线 |
| Windows reboot 校验 | **已触发** `shutdown /r` + AtLogOn 任务 `MJH Client OTA Reboot Validate` → 结果写入 `test5-reboot-result.json`（会话中断后可读） |

软恢复（未等 reboot 文件）：Client 已由 installer 拉起为 1.0.8。

### 5. PrintJob E2E

| 检查项 | 结果 |
|--------|------|
| `POST /local/printer/test` | **PASS** — ok=true（hardware + V2 demo） |
| `cloud.online` | **false**（本轮 Agent 报 cloud offline） |
| Cloud PENDING→CLAIMED→PRINTED | **PENDING**（未下正式云订单） |

---

## Logs

### Apply harness（修复路径，非管理员）

`docs/rc-reports/client-ota-real-upgrade/test1-apply-result.json` — ELEVATION_REQUIRED 形状正确。

### installer-start.log（摘录）

```text
CLIENT_APPLY_LAUNCH … oldVersion=1.0.7 newVersion=1.0.8 elevated=false
CLIENT_APPLY_MODE mode=uac-runas pid=28416
```

### ProgramData\MJH Printer Client\logs\client-update.log（摘录）

```text
CLIENT UPDATE START
oldVersion=1.0.7
newVersion=1.0.8
installer=...\MJH Printer Setup.exe
pid=27284
CLIENT INSTALL PROCESS START pid=2592
CLIENT INSTALL FINISHED
exitCode=0
CLIENT UPDATE DONE
```

### 注册表

```text
DisplayName    = MJH Printer Client 1.0.8
DisplayVersion = 1.0.8
```

---

## Result

| 场景 | 判定 |
|------|------|
| 1 普通用户 + ELEVATION_REQUIRED 形状 | **PASS**（修复模块真实 Invoke；*非* 旧 1.0.7 UI 二进制） |
| 2 UAC fallback | **PASS** |
| 3 安装 → 注册表 1.0.8 + 日志 + 任务 | **PASS** |
| 4 重启恢复 | **PARTIAL** — 安装后已拉起 1.0.8；正式 reboot 结果见 `test5-reboot-result.json` |
| 5 打印 | **PASS*** — 本地 printer/test；云端全链路 PENDING（cloud.offline） |

**总体：** 含 Apply 修复的 1.0.8 Setup，在普通用户 + UAC 路径下 **1.0.7→1.0.8 安装闭环 PASS**。  
**门店注意：** 已发布的 GitHub `v1.0.8` Setup **不含**本修复；需再发一版（或同版本重发）才能让「已装 1.0.8」的 UI Apply 也走新生命周期。

---

## Remaining Risk

1. **鸡生蛋：** 从「无修复的 1.0.7」点 UI 更新，仍跑旧 Apply（闪退空成功），直到装上含修复的包。  
2. **发布物漂移：** Cloud/GitHub 当前 1.0.8 SHA ≠ 本次验证用的修复构建 SHA。  
3. **`cloud.online=false`：** 云订单 E2E 未证。  
4. **SmartScreen / 未签名 Setup：** 门店可能额外拦截。  
5. **reboot 结果文件：** 若 AtLogOn 任务未跑，需人工打开 `test5-reboot-result.json`。
