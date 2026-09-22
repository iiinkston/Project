# OTA Release Validation — v1.0.5 Bootstrap

**Date (UTC):** 2026-09-22  
**Verdict:** **Bootstrap build READY**（本地构建 + OTA 回归模拟 PASS；门店 Apply/Print E2E 待装机后补）

---

## Version

| Component | Version | Source of truth |
|-----------|---------|-----------------|
| Client | **1.0.5** | `mjh-printer-client/package.json` (+ electron-builder `buildVersion` / `extraMetadata`) |
| Agent | **2.4.5** | `mjh-printer-agent/package.json` + `src/version.ts` |
| Runtime smoke | `MJH-Printer-Agent.exe version` → **2.4.5** | PASS |
| Tag | **v1.0.5** | GitHub Release |

---

## Build

| Step | Result |
|------|--------|
| Agent `pnpm test` | **114/114 PASS** |
| Agent `pnpm typecheck` | **PASS** |
| Agent `pnpm build:exe` | **PASS** → `MJH-Printer-Agent-v2.4.5.zip` |
| Client `pnpm test` | **12/12 PASS** |
| Client `pnpm typecheck` | **PASS** |
| Client `pnpm dist:setup` | **PASS** → `MJH Printer Setup.exe` → staged as `MJH-Printer-Setup.exe` |

包含 OTA 能力：nested/flat manifest、Agent zip staging、BOM config。

---

## SHA256

certutil / Get-FileHash（小写 64 hex）：

```
CLIENT_UPDATE_SHA256=38a215f6efda13b1444f51c7250e0510c94be383d254646c2631fc5d781dfdbd
AGENT_UPDATE_SHA256=5783fe1d2928831ca973a5a680b0e47666a5405fa276a6acd8708fcb49512e8f
```

文件：`docs/release-sha256-v1.0.5.txt`、`docs/release-metadata-v1.0.5.json`

---

## GitHub Release

| Item | Value |
|------|-------|
| Tag | `v1.0.5` |
| Assets | `MJH-Printer-Setup.exe`, `MJH-Printer-Agent-v2.4.5.zip`, `release-metadata.json` |
| URL | https://github.com/iiinkston/Project/releases/tag/v1.0.5 |

---

## Cloud Manifest

运维更新 `.env.production`（详见 `docs/ota-release-v1.0.5.md`）：

```env
CLIENT_VERSION=1.0.5
CLIENT_UPDATE_URL=https://github.com/iiinkston/Project/releases/download/v1.0.5/MJH-Printer-Setup.exe
CLIENT_UPDATE_SHA256=38a215f6efda13b1444f51c7250e0510c94be383d254646c2631fc5d781dfdbd

AGENT_VERSION=2.4.5
AGENT_UPDATE_URL=https://github.com/iiinkston/Project/releases/download/v1.0.5/MJH-Printer-Agent-v2.4.5.zip
AGENT_UPDATE_SHA256=5783fe1d2928831ca973a5a680b0e47666a5405fa276a6acd8708fcb49512e8f
```

**未改** Cloud API / schema（仍为嵌套 `client` / `agent`）。

---

## OTA Test

模拟基线 **1.0.5 / 2.4.5** → 测试目标 **1.0.6 / 2.4.6**（本地 HTTP nested manifest）：

脚本：`mjh-printer-agent/scripts/ota-bootstrap-regression-v105.mts`

| Check | Result |
|-------|--------|
| 1. Manifest nested parse | **PASS** |
| 2. Client check fields + download + SHA256 | **PASS** |
| 2b. Client Install / restart | **SIMULATED_SKIP**（需门店 Setup Apply） |
| 3. Agent check → zip download → verify → extract → stage EXE | **PASS** |
| 3b. Agent replace / restart | **SIMULATED_SKIP**（需 `update-agent.ps1` Apply） |
| 4. Live `/local/status`（本机运行中 Agent） | `bound=true`, `cloud.online=true`, `printer.online=true` — **PASS_READ** |
| 5. Print pipeline PENDING→CLAIMED→PRINTED | **PENDING**（本轮未跑 PrintJob） |
| BOM `update.json` | **PASS** |

---

## Known Issues

1. **v1.0.4 不能作 OTA 基线** — 缺兼容解析；门店必须先装 **1.0.5 Setup**。  
2. **Apply / 重启** 未在本会话对真实 Setup/zip 做破坏性升级（避免打断当前绑定 Agent）。  
3. **PrintJob E2E** 未执行（范围外；与 OTA 发布解耦）。  
4. **Cloud env** 需人工写入生产；本仓无 `.env.production`。  
5. 本机 PATH 上的 `gh` 是错误的 npm 包；发 Release 使用官方 `gh` CLI 二进制。

---

## Production mode after this release

```
首次部署: MJH-Printer-Setup.exe (Client 1.0.5 + Agent 2.4.5)
以后: Cloud Manifest → OTA → 自动升级
```
