# Agent OTA Elevation Production Fix — 2.4.7

**Date (UTC):** 2026-09-22  
**Version:** Agent **2.4.7**  
**Scope:** 仅修复 Apply 权限执行链；不改 OTA 架构（download → verify → stage → apply → restart）。

---

## Root cause

`update-agent.ps1` 含 `#Requires -RunAsAdministrator`。  
Local API 在非管理员进程（或非 SYSTEM）中直接 `spawn` 脚本时：

- 脚本实际无法改写 Program Files  
- API 仍返回 `ok: true` → **空成功**

---

## Fix

| Piece | Change |
|-------|--------|
| `src/local/update-elevation.ts` | 提权启动链：direct / Scheduled Task / UAC RunAs |
| `src/local/update.ts` `handleUpdateApply` | 非提权路径返回 `ok:false` + `code: ELEVATION_REQUIRED` + `elevationStarted:true` |
| `scripts/apply-update-helper.ps1` | SYSTEM 任务入口：读 `apply-request.json` → 调 `update-agent.ps1` |
| `scripts/install.ps1` | 注册任务 `MJH Printer Agent Update`（SYSTEM Highest；AU 可 Run） |
| `scripts/update-agent.ps1` | 升级成功后自愈注册同一任务 |
| `src/local/types.ts` | `LocalErrorResponse.code` / `elevationStarted` |

### Apply 行为

| 进程权限 | 行为 | HTTP 语义 |
|----------|------|-----------|
| 已提权（Admin/SYSTEM） | 直接跑 `update-agent.ps1` | `ok: true` |
| 普通用户 + 计划任务可用 | `schtasks /Run` → helper | `ok: false`, `code=ELEVATION_REQUIRED`, `elevationStarted=true` |
| 普通用户 + 无计划任务 | UAC `RunAs` 兜底 | 同上（禁止空成功） |
| 无法启动 | — | `ok: false`, 无 elevationStarted |

门店机：Agent 通常由 SYSTEM 计划任务运行 → Apply 走 **direct**；Client 点更新无需额外 UAC。  
若 Agent 以普通用户运行：优先 SYSTEM Update 任务（安装时已授权 Authenticated Users 可 Run），避免弹 UAC。

---

## Tests

| Case | Result |
|------|--------|
| 1 管理员 Apply → direct + ok | PASS |
| 2 普通用户 → scheduled-task + elevationRequired | PASS |
| 2b 无任务 → uac-runas | PASS |
| 3 失败 → ok:false | PASS |
| API 无包 → 非空成功 | PASS |

---

## Build

- `pnpm test`  
- `pnpm typecheck`  
- `pnpm build:exe` → `MJH-Printer-Agent-v2.4.7.zip`

---

## Remaining

- 已装门店需升到 **2.4.7**（含 helper + 任务）后，非 SYSTEM 场景才免 UAC。  
- Client UI 可识别 `code=ELEVATION_REQUIRED` 显示「更新已启动，请稍候」而非「成功」。
