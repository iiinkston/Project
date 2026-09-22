# Client OTA Crash Report

**Date:** 2026-09-22  
**Scope:** Windows Client OTA Apply（1.0.7 → 1.0.8）  
**Constraint:** 本报告仅排查，**未改代码**。

---

## Root Cause

**主因：UI Apply 路径在安装尚未启动/完成时就让 Electron 退出，并把“已启动安装”当作成功返回（空成功 + 闪退）。**

具体机制：

1. Client OTA 是 **路径 A**（不是 Agent 装 Client，也不是 `electron-updater`）：
   - Electron `client-update-service.apply()` 下载已完成的 Setup
   - `spawn(powershell … -File update-client.ps1 -SetupPath …)`  
     选项：`detached: true`、`stdio: "ignore"`、`windowsHide: true`、`child.unref()`
   - 立即 `return { ok: true, quitting: true }`（**不等待**子进程、**不读** exit code、**不挂** `error` 监听）
2. `main.cjs` 在 Apply 返回后 **400ms** 调用 `app.quit()` → 用户感知为 **Client 闪退**。
3. 本机失败证据表明 **`update-client.ps1` 在 14:22 / 14:23 两次 UI Apply 中根本没有写入 `client-update.log`**（脚本正常时第一条就是 `CLIENT UPDATE START`）。因此 NSIS Setup **未进入已记录的成功安装路径**，版本仍停在 **1.0.7**。
4. 同机历史上 **PASS** 的 Client 升级（→1.0.6 / →1.0.7）来自 **已提权外部脚本**直接同步执行 `update-client.ps1`（GA elevated harness），与 UI Apply 路径不同。UI 路径依赖隐藏 PowerShell + `Start-Process -Verb RunAs`（UAC），与父进程秒退叠加后不可靠。

次要风险（同一条链路上）：

- `update-client.ps1`：`Stop-Process` / `taskkill` 后再 `Start-Process Setup /S -Verb RunAs`；perMachine NSIS **必须管理员**。
- Electron 层 **假成功**：安装结果未知仍 `ok: true`。
- 无 `installer-start` / wait / exitCode 结构化日志，失败不可观测。

---

## Evidence

### 1. 更新模式确认（A vs B）

| 项 | 结论 |
|----|------|
| Agent 调用 Client Installer | **否**（Agent 源码无 Setup/update-client 调用） |
| Client Electron `apply` → `update-client.ps1` → NSIS `/S` | **是（路径 A）** |
| `electron-updater` / `autoUpdater` | **未使用** |

实际 Apply 命令（代码等价）：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File
  "C:\Program Files\MJH Printer\resources\updater\update-client.ps1"
  -SetupPath
  "C:\Users\<user>\AppData\Local\MJH Printer Client\updates\MJH Printer Setup.exe"

spawn options: detached=true, stdio=ignore, windowsHide=true, unref()
Electron 返回: ok=true, quitting=true
400ms 后: app.quit()
```

`update-client.ps1` 内安装命令：

```text
Start-Process -FilePath $SetupPath -ArgumentList "/S" -Wait -PassThru -Verb RunAs
```

### 2. 下载 / SHA（Apply 之前）— PASS

`client.log`：

```text
2026-09-22T14:21:14Z CLIENT OTA CHECK current=1.0.7 latest=1.0.8 available=true
2026-09-22T14:21:23Z CLIENT OTA DOWNLOAD START version=1.0.8
2026-09-22T14:22:11Z CLIENT OTA DOWNLOAD SUCCESS version=1.0.8
2026-09-22T14:22:11Z CLIENT OTA READY
2026-09-22T14:22:17Z CLIENT OTA APPLY setup=...\updates\MJH Printer Setup.exe
                     script=C:\Program Files\MJH Printer\resources\updater\update-client.ps1
```

本地文件：

| 项 | 值 |
|----|-----|
| Setup 路径 | `%LOCALAPPDATA%\MJH Printer Client\updates\MJH Printer Setup.exe` |
| Size | 97920199 |
| SHA256 | `7b2a5cae826b5203ec6c0b32f5d9251ac9835096b97228ce8dff77475a19be4e` |
| 与 `ota-state.json` | **一致** |
| 权限 | 用户可读写 LocalAppData（下载无问题） |

### 3. Apply 失败证据 — 安装未完成

| 证据 | 含义 |
|------|------|
| `client-update.log` **无** 14:22 / 14:23 记录 | `update-client.ps1` 未执行到首条 `Write-UpdateLog`（或进程未真正起来） |
| 同文件有 10:23 / 10:56 完整 SUCCESS（elevated 路径） | 脚本与日志路径本身可用 |
| Apply 后 14:22:35 再次 `app start version=1.0.7` | 闪退后仍以旧版本回来 |
| 第二次 Apply 14:23:07 后 Client 进程消失 | 再次 quit，未见安装完成重启到 1.0.8 |
| 注册表 `DisplayName=MJH Printer Client 1.0.7` / `DisplayVersion=1.0.7` | **未升级** |
| 当前无 `MJH Printer Client` 进程 | Apply 后未稳定回到新版本 |

对比（**elevated 成功**时 `client-update.log`）：

```text
CLIENT UPDATE START setup=...
Stopping Client processes...
Running silent NSIS setup...
Setup exitCode=0
Restarting Client: ...
CLIENT UPDATE DONE
```

UI 失败时：**整段缺失**。

### 4. NSIS / package.json（安装器行为）

```json
"nsis": {
  "oneClick": false,
  "perMachine": true,
  "allowToChangeInstallationDirectory": true,
  "runAfterFinish": true,
  "include": "installer/nsis-agent.nsh"
}
```

| 项 | 结论 |
|----|------|
| 管理员 | **需要**（perMachine → Program Files） |
| 静默参数 | `/S`（脚本已用） |
| 覆盖旧版 | NSIS 升级安装；`customInstall` 跑 Agent `install.ps1` |
| 结束旧进程 | 脚本侧 `Stop-Process` + `taskkill`；**非** NSIS 内建 uninstallPreviousVersions 字段 |
| `runAfterFinish` | true — 仅当 Setup **真正跑完**才会再拉起 Client |

### 5. 旧进程 / 文件锁

`update-client.ps1` 在 Setup 前强制结束 `MJH Printer Client`。  
UI 路径上 Electron 已在 ~400ms 自行 `quit`，与脚本杀进程重叠；**本轮失败时 Setup 未记入日志，故主矛盾不是 asar 文件锁**，而是 **updater 未可靠启动 / 未提权完成安装**。  
若 Setup 在 Client 仍占用 `resources\app.asar` 时启动，才会出现文件锁类失败——需在修好启动/等待逻辑后用 exitCode 再验证。

### 6. Agent 角色

Agent 可正常拉 `/printer/update/latest` 与 **Client 自身 OTA Apply 无关**。  
Client 闪退不是 Agent 杀 Client，而是 **Client Apply 主动 quit**。

### 7. 返回码 / 堆栈（Electron 层）

| 项 | 现状 |
|----|------|
| spawn 返回码 | **未捕获**（stdio ignore + unref） |
| Setup exitCode | 仅写入 `client-update.log`（本次失败无新行） |
| 异常堆栈 | Electron Apply **无 try/catch 包装子进程失败**；子进程失败对 UI 不可见 |
| UI 看到的结果 | `ok: true` / “安装已启动” → **空成功** |

---

## Fix

（建议实现顺序；**尚未改代码**。）

1. **禁止空成功**  
   - Apply 在确认 updater 已启动（或 Setup 已拿到 exitCode）之前，不得 `ok: true`。  
   - 子进程 `error` / 非零退出 → `ok: false` + 明确 error。

2. **调整生命周期（二选一或组合）**  
   - **推荐（对齐 Agent）**：用已注册的 Scheduled Task / 独立 elevated helper 跑 `update-client.ps1`，返回 `ELEVATION_REQUIRED` 或明确“已排队”，**不要**在 400ms 内 `app.quit()` 假装成功。  
   - 或：先 `Start-Process -Verb RunAs` 拿到 UAC，再退出 Electron；退出前写入 pending 标记。  
   - 禁止：`detached + unref + ignore + 立即 quit` 作为唯一路径。

3. **进程与安装顺序**  
   - 记录 PID；graceful 尝试后再 taskkill。  
   - Setup `/S` **Wait** 结束并校验 `DisplayVersion` / `app.getVersion` 预期后再宣称 DONE。  
   - 重启 Client 仅在 `exitCode=0` 且 EXE 存在之后。

4. **必须增加的日志（按需求）**  
   - `%LOCALAPPDATA%\MJH Printer Client\logs\installer-start.log`（JSON 行）：  
     `timestamp, oldVersion, newVersion, installerPath, args, pid, exitCode`  
   - Agent 侧若未来代跑 Client：`update-client.log` 记录 download / sha / execute / wait / result。  
   - Electron：spawn 前后写 `client.log`（pid、error、exit）。

5. **不要**用 try/catch 吞掉失败或返回 fake success。

---

## Regression Test

环境：洁净或可回滚机；**禁止**只测 elevated harness。

| # | 步骤 | 期望 |
|---|------|------|
| 1 | 安装 Client **1.0.7**，绑定，打印 | PASS |
| 2 | Manifest 指向 **1.0.8** Setup + 正确 SHA | check 显示可更新 |
| 3 | UI：下载 | SHA PASS，`ota-state.ready=true` |
| 4 | UI：Apply | **不得**仅闪退；需 UAC 或任务启动有日志 |
| 5 | `client-update.log` / `installer-start.log` | 有 START → Setup exitCode → DONE |
| 6 | 注册表 / 启动日志 | `DisplayVersion=1.0.8`，`app start version=1.0.8` |
| 7 | 打印 | PASS |
| 8 | 故意取消 UAC | `ok: false` 或明确失败，**版本仍 1.0.7**，无假成功 |
| 9 | 对照：elevated 直接跑 `update-client.ps1` | 仍应 PASS（不回归） |

---

## Production Risk

| 风险 | 说明 |
|------|------|
| 门店点“安装更新”只见闪退 | 当前 UI Apply 主路径即如此 |
| 版本卡在旧版且 UI 曾提示成功 | 空成功误导运维 |
| UAC / SmartScreen | perMachine 无签名 Setup；提权失败时更易踩坑 |
| GA 报告中的 Client Apply PASS | 多来自 **elevated 脚本**，**不能**代表门店 UI Apply 已 READY |
| Agent OTA | 本问题独立；勿混为 Agent 故障 |

**结论：** Client OTA **下载/SHA 正常**；崩溃感来自 **Apply 主动 quit + updater 未可靠执行/未记日志**；升级未完成已由注册表与 `client-update.log` 缺口证实。修复前 **门店 UI Client Apply 应视为 NOT READY**。
