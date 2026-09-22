# MJH Printer OTA Compatibility Fix Report

**Date (UTC):** 2026-09-22  
**Scope:** OTA 兼容层 only（未改 pairing / PrintJob / Claim / ESC-POS / Printer Worker / DB schema；未重设 OTA 架构）  
**Verdict:** **代码侧阻断项已修；Cloud `.env.production` 需运维用下方真实 hash 更新（本仓无 Cloud 源码）**

---

## Root cause

来自 `docs/ota-remote-acceptance-report.md` 的四条阻断根因：

| # | Root cause | Effect |
|---|------------|--------|
| 1 | Cloud `GET /v1/printer/update/latest` 返回嵌套 `{ client:{version,url,sha256}, agent:{…} }`，Client/Agent 只认扁平 `clientVersion` / `agentVersion` | Check 直接失败 |
| 2 | Cloud 声明的 SHA256 与 GitHub Release 实文件不一致 | 即便能解析也会在 Download 拒装 |
| 3 | Cloud `agent.url` 指向 `.zip`，Agent OTA 却把下载体当 EXE 落盘；`update-agent.ps1` 只接受 EXE Source | Download/Apply 包形态不匹配 |
| 4 | PowerShell `Set-Content -Encoding utf8` 写 `update.json` 带 UTF-8 BOM → `JSON.parse` 失败 → `enabled=false` | OTA 看起来开了其实没开 |

---

## Fix strategy（兼容，不改 Cloud schema）

1. **Cloud 保持嵌套**；Client / Agent 解析层同时支持扁平 + 嵌套。  
2. **Agent Download**：若 URL 以 `.zip` 结尾 → 校验 zip SHA256 → 解压 → 定位 `MJH-Printer-Agent.exe` → 写入 `ProgramData\updates\`；Apply 仍走既有 `update-agent.ps1 -Source EXE`（Task Scheduler / ProgramData / binding token 不变）。  
3. **Config loader**：读文件后先 strip `\uFEFF` 再 `JSON.parse`。  
4. **SHA256**：对本机匿名下载的 Release 资产重新计算（不信任旧 Cloud 记录）。

---

## Recalculated SHA256（2026-09-22 实测）

来源：`https://github.com/iiinkston/Project/releases/download/v1.0.4/…`（匿名 HTTP 200）

| Asset | Size | SHA256 (64 hex, lowercase) |
|-------|------|----------------------------|
| `MJH-Printer-Setup.exe` | 97115825 | `b6314b9989f2e5dedd17d59d97fca9278b85a38c6f019c32f620a0e57c9289b1` |
| `MJH-Printer-Agent-v2.4.4.zip` | 21931207 | `8acba63f58dc28ec863ee267e929910089876a167240b90cfbce34ebce9fb9e9` |

旧 Cloud 错误值（勿再用）：

- Client: `150b537f0d5c8b04e633c41ef9c68d0b83f08837fbbf8cb05f59c3c2f5b5de5e`
- Agent: `33693ab52c886e653f9cd3559780784cb28668f76c7c1874698c100acc3fb881`

### Cloud `.env.production`（本仓无此文件）

请在 **Cloud 部署环境** 将 OTA hash 更新为上述真实值（变量名以 Cloud 实际为准，示例如下）：

```env
# docs/ota-cloud-env.production.snippet — paste into Cloud .env.production
PRINTER_CLIENT_VERSION=1.0.4
PRINTER_CLIENT_URL=https://github.com/iiinkston/Project/releases/download/v1.0.4/MJH-Printer-Setup.exe
PRINTER_CLIENT_SHA256=b6314b9989f2e5dedd17d59d97fca9278b85a38c6f019c32f620a0e57c9289b1

PRINTER_AGENT_VERSION=2.4.4
PRINTER_AGENT_URL=https://github.com/iiinkston/Project/releases/download/v1.0.4/MJH-Printer-Agent-v2.4.4.zip
PRINTER_AGENT_SHA256=8acba63f58dc28ec863ee267e929910089876a167240b90cfbce34ebce9fb9e9
```

要求：64 hex、小写、无空格、无换行。更新后重启 Cloud / 确认 `GET …/update/latest` 返回新 hash。

---

## Changed files

### Client (`mjh-printer-client`)

| File | Change |
|------|--------|
| `electron/json-bom.cjs` | **新增** `stripBom` / `parseJsonText` |
| `electron/client-update-lib.cjs` | 嵌套+扁平 `parseClientManifest`；`loadOtaConfig`/`readJsonSafe` BOM 安全；SHA 去空白 |
| `electron/client-update-lib.test.cjs` | nested manifest、BOM config 测试 |

### Agent (`mjh-printer-agent`)

| File | Change |
|------|--------|
| `src/update/json-bom.ts` | **新增** BOM strip |
| `src/update/ota-manifest-normalize.ts` | **新增** nested/flat → `RemoteUpdateManifest` |
| `src/update/ota-manifest.ts` | 使用 normalize + BOM-safe JSON |
| `src/update/ota-config.ts` | `JSON.parse(stripBom(…))` |
| `src/update/ota-download.ts` | zip 下载校验 → Expand-Archive → stage EXE；仍支持直接 EXE URL |
| `src/update/ota-service.test.ts` | nested、BOM、zip extract+download 测试 |

**未修改：** `update-agent.ps1`（仍 EXE Source）、Task Scheduler、ProgramData 布局、binding token、Cloud pairing、PrintJob、Claim、ESC/POS、Worker、DB。

---

## Test result

### Unit / integration（本机）

| Suite | Result |
|-------|--------|
| `mjh-printer-client` `pnpm test` | **12/12 PASS**（含 nested manifest、BOM） |
| `mjh-printer-agent` `tsx --test src/update/ota-service.test.ts` | **9/9 PASS**（含 nested、flat、BOM、EXE download、zip→EXE、SHA reject） |

覆盖点：

- Client nested `{ client:{ version:"1.0.4" } }` 可解析  
- Agent nested `{ agent:{ version,url,sha256 } }` 可解析  
- Agent zip：download → sha256 verify → extract → replace staging EXE  
- Config：UTF-8 no BOM **PASS**；UTF-8 BOM **PASS**

### Store E2E acceptance（1.0.3→1.0.4 / 2.4.3→2.4.4）

| Item | Status |
|------|--------|
| Client Check shows 1.0.4 | **代码已具备**；需：**① Cloud hash 已更正 ② 门店 Client 已含本兼容解析**（见 Remaining risk） |
| Client Download / SHA / Install | 同上 |
| Agent 2.4.3→2.4.4 + bound/cloud/printer | 同上；zip 路径需 **含本版 download 逻辑的 Agent** |

本机当前已是 1.0.4 / 2.4.4，无法在本会话重跑旧版→新版洁净机闭环（与验收报告 Phase 0 相同限制）。

---

## Remaining risk

1. **鸡生蛋（高）**  
   已发布到门店的 **Client 1.0.3 / Agent 2.4.3 二进制不含本解析与 zip 逻辑**。仅改 Cloud 为嵌套 + 正确 hash **不能**让旧包忽然读懂嵌套或解 zip。  
   **落地建议（二选一，一次）：**  
   - 手工 / 现场用 Setup.exe + `update-agent.ps1` 装上含本修复的构建，之后走 Cloud OTA；或  
   - 过渡期 Cloud 临时双发扁平字段（本任务刻意不改 Cloud API 形状，故推荐前者）。

2. **Cloud env 未在本仓落地（高）**  
   仓库内无 `.env.production`；运维必须把上表 hash 写入生产并验证 API。

3. **Agent zip 依赖 PowerShell `Expand-Archive`（中）**  
   门店 Windows 一般可用；若策略禁用 PowerShell，需改 Cloud 指 EXE URL（本 downloader 仍支持 `.exe`）。

4. **Apply / 重启路径未在本会话实机跑通（中）**  
   Download staging 已测；Apply 仍复用既有 `update-agent.ps1` / `update-client.ps1`。建议 Cloud hash 修好后在一台仍绑定门店机做一次完整 Apply，确认 `bound=true`、`cloud.online=true`、`printer.online=true`。

5. **Client 1.0.4 已装机若不含本 patch**  
   需重新打含兼容解析的 Client 包再分发，否则 Check 对嵌套 manifest 仍会失败。

---

## Acceptance mapping

| Criterion | After this fix |
|-----------|----------------|
| Nested Cloud manifest 可被 Client/Agent 解析 | **PASS**（单测） |
| 真实 Release SHA256 已知且可写入 Cloud | **PASS**（已重算；待运维写入） |
| Agent zip → EXE staging | **PASS**（单测） |
| update.json BOM | **PASS**（单测） |
| 门店 1.0.3→1.0.4 / 2.4.3→2.4.4 全链路 | **BLOCKED until** Cloud hash 更新 + 含本修复的二进制到达门店（或一次手工升级） |
