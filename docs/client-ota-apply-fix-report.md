# Client OTA Apply Fix Report

**Date:** 2026-09-22  
**Scope:** Client Electron Apply lifecycle only（未改 Agent / Manifest）

---

## Root Cause

UI Apply 用 `detached` + `unref` + `stdio:ignore` 启动 `update-client.ps1` 后立即 `ok: true`，并在约 400ms `app.quit()`。安装脚本未可靠执行，用户感知闪退，注册表版本不变 → **空成功**。

详见 `docs/client-ota-crash-report.md`。

---

## Changes

| 文件 | 变更 |
|------|------|
| `electron/client-update-elevation.cjs` | **新增** — 对齐 Agent：SYSTEM 计划任务优先，否则 UAC RunAs；写 `apply-request.json` + `installer-start.log` |
| `electron/client-update-service.cjs` | Apply 走 elevation；非 elevated 返回 `ok:false code=ELEVATION_REQUIRED elevationStarted=true`；仅 elevated direct 返回 `ok:true` |
| `electron/main.cjs` | 仅在任务/进程 **已接受** 后延迟退出（1.5s，非假成功）；记录 accepted 日志 |
| `scripts/update-client.ps1` | 结构化日志（START / pid / exitCode）；已提权时直接 `/S`（禁止嵌套 RunAs）；日志写入 ProgramData + LocalAppData |
| `scripts/apply-client-update-helper.ps1` | **新增** — SYSTEM 任务入口 |
| `scripts/register-client-ota-task.ps1` | **新增** — 注册 `MJH Printer Client Update`（AU 可 `/Run`） |
| `installer/nsis-agent.nsh` | `customInstall` 注册 Client OTA 任务 |
| `package.json` | 打包 helper/register 脚本；测试加入 elevation suite |
| `src/App.tsx` / `vite-env.d.ts` | 处理 `ELEVATION_REQUIRED` toast |

### NSIS 参数（未破坏）

保持：`perMachine=true`、`oneClick=false`、静默 `/S`。未改 `/D=` 默认安装目录行为。

### 新流程

```text
普通用户 Apply
  → write apply-request.json
  → schtasks /Run "MJH Printer Client Update"  (优先)
  → 失败则 UAC RunAs update-client.ps1
  → 返回 ok:false + ELEVATION_REQUIRED + elevationStarted
  → UI: “Update started, application will restart”
  → 确认启动后再 quit（安装脚本杀进程 / Setup / 重启 Client）

管理员 / 已提权进程
  → direct update-client.ps1
  → ok:true + quitting
```

---

## Security Considerations

- SYSTEM 任务 ACL：Administrators/SYSTEM Full；Authenticated Users 可读可执行（与 Agent Update 任务同模式）。
- Setup 仍需写入 Program Files → 必须提权；普通用户不可无 UAC/任务完成安装。
- 禁止把“已请求提权”标成 `ok:true`。
- `installer-start.log` / `client-update.log` 便于审计，不含 token。

---

## Test Result

```text
pnpm test (mjh-printer-client)
```

覆盖：

1. 普通用户 Apply → `ok:false` + `ELEVATION_REQUIRED` + `elevationStarted`（scheduled-task）
2. 管理员 Apply → `ok:true` + `mode=direct`
3. 任务缺失 → UAC fallback + apply-request 写入
4. 既有 compareVersions / download SHA 测试保持

（装机后注册表 = 新版本、重启后 online：需在真实 Windows + UAC/任务环境做手工回归，见下。）

---

## Deployment Notes

1. 发布含本修复的 Client（建议随 `1.0.8` 或下一 patch）。
2. **从 1.0.7 UI 升级到首个含修复的版本**：机器上可能尚无 `MJH Printer Client Update` 任务 → 走 **UAC**；用户需同意 UAC。安装成功后 NSIS 会注册任务，后续升级可无 UAC（若 ACL 生效）。
3. 运维可手工：以管理员运行  
   `…\resources\updater\register-client-ota-task.ps1`
4. 日志：
   - `C:\ProgramData\MJH Printer Client\logs\client-update.log`
   - `C:\ProgramData\MJH Printer Client\updates\installer-start.log`
   - `%LOCALAPPDATA%\MJH Printer Client\logs\client-update.log`
5. 勿再使用“立刻 ok + 400ms quit”的旧 Apply 行为做门店验收。
