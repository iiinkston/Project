# OTA Real Upgrade Validation Report

**Date (UTC):** 2026-09-22  
**Tag / package:** `v1.0.6-test`  
**Final Result:** **PARTIAL — Download/SHA PASS；live Apply / Bootstrap 基线 / Cloud 临时配置 = PENDING**

未改业务代码（Cloud API / Pairing / DB / Print Worker）。仅构建测试版本并做验证。

---

## Environment

| Item | Value |
|------|-------|
| Machine | `DESKTOP-1N2OP3S`（开发机，非洁净门店机） |
| OS | Windows 11 10.0.26200 |
| Session admin | **False**（无法写 `ProgramData\...\update.json`，无法静默跑 `update-agent.ps1`） |
| Cloud Update API | `http://206.189.80.83/api/v1/printer/update/latest`（**未在本轮改生产 env**） |
| Test Release | https://github.com/iiinkston/Project/releases/tag/v1.0.6-test |
| Bootstrap Release | https://github.com/iiinkston/Project/releases/tag/v1.0.5 |

---

## Before Version

| Component | Actual on machine | Expected Bootstrap |
|-----------|-------------------|--------------------|
| Client | 已装 `MJH Printer`（ProductVersion 显示 Electron 34.5.8；**未确认 UI 为 1.0.5**） | 1.0.5 |
| Agent | **2.4.4**（`GET /local/status`） | **2.4.5** |
| bound | `true` | — |
| cloud.online | `true` | — |
| printer.online | `true`（XP-N160II `192.168.0.110:9100`） | — |

**阻断：** 本机 **不是** Bootstrap 1.0.5 / 2.4.5。Agent 2.4.4 **无** nested manifest / zip OTA，无法作为真实 OTA 基线。

---

## Target Version

| Package | Version | Asset |
|---------|---------|-------|
| Client | **1.0.6** | `MJH-Printer-Setup.exe` |
| Agent | **2.4.6** | `MJH-Printer-Agent-v2.4.6.zip` |

SHA256：

```
CLIENT_UPDATE_SHA256=503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1
AGENT_UPDATE_SHA256=ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d
```

详见 `docs/ota-real-upgrade-test-v1.0.6.md`。

---

## Download Result

| Path | Result | Evidence |
|------|--------|----------|
| GitHub 匿名下载 Setup + Agent zip | **PASS** | certutil / Get-FileHash 与声明一致 |
| Client nested parse + `downloadVerifiedFile` → `%LOCALAPPDATA%\MJH Printer Client\updates\MJH Printer Setup.exe` | **PASS** | sha256 匹配 |
| Live Agent `POST /local/update/download`（本机 2.4.4） | **FAIL** | HTTP 400；`lastError` = missing `agentVersion`（嵌套 schema） |
| Agent 源码路径模拟 **2.4.5→2.4.6**：nested manifest → GitHub zip → SHA → extract → stage EXE | **PASS** | staged ~58MB EXE，`ready=true`（隔离 ProgramData 目录，**未**写入安装目录） |

---

## SHA Verification

| Asset | Result |
|-------|--------|
| Client Setup | **PASS** |
| Agent zip | **PASS** |

---

## Apply Result

| Step | Result |
|------|--------|
| Client Setup 静默安装 / `update-client.ps1` | **PENDING**（未执行；避免无确认覆盖本机 Client） |
| Client version 更新 / 配置保留 / pairing 保留 | **PENDING** |
| Agent `update-agent.ps1` replace + restart | **PENDING**（非管理员；未对 Program Files 执行 Apply） |
| Live Agent 版本变为 2.4.6 | **PENDING**（仍为 **2.4.4**） |

---

## Service Recovery

| Check | Result |
|-------|--------|
| Apply 后 bound / cloud / printer | **PENDING**（未 Apply） |
| Apply 前快照（仍 2.4.4） | `bound=true`, `cloud.online=true`, `printer.online=true` — **PASS（基线仍在线）** |

---

## Print Test

| Item | Result |
|------|--------|
| `POST /local/printer/test`（升级**前**，Agent 2.4.4） | **PASS** — `ok=true`，`Print jobs sent successfully (hardware + V2 demo)` |
| 升级**后** PENDING→CLAIMED→PRINTED 全链路 | **PENDING**（未 Apply，无法做升级后回归） |
| 无重复打印 / 无 token 丢失 / 无 unbind（升级后） | **PENDING** |

---

## Cloud Manifest

| Item | Result |
|------|--------|
| 文档中的临时 `.env.production` 值 | **已写**于 `docs/ota-real-upgrade-test-v1.0.6.md` |
| 生产 Cloud 实际已切换到 1.0.6-test | **PENDING**（本仓无 Cloud 部署权；本轮未改远程 env） |
| 本机写 `ProgramData\...\update.json` 指向临时 manifest | **FAIL / 拒写**（Access Denied，非管理员） |

---

## Final Result

| Criterion | Status |
|-----------|--------|
| Test Release 已发布 | **PASS** — [v1.0.6-test](https://github.com/iiinkston/Project/releases/tag/v1.0.6-test) |
| SHA256 正确可下载 | **PASS** |
| Client OTA download + SHA（库路径） | **PASS** |
| Agent OTA zip download + SHA + extract（2.4.5→2.4.6 源码模拟） | **PASS** |
| 本机已是 Bootstrap 后真实 Apply | **PENDING** |
| Cloud 临时指向 test 包 | **PENDING** |
| 升级后 Print pipeline | **PENDING** |

### 要完成真实闭环，还需（人工 / 管理员）

1. 安装 Bootstrap：**Client 1.0.5 Setup**（或确认 Client 已是 1.0.5）+ Agent **2.4.5**  
2. 管理员更新 Cloud env（或门店 `update.json`）为 `docs/ota-real-upgrade-test-v1.0.6.md` 中的 URL/SHA  
3. Client：Check → Download → Apply → 确认 version=1.0.6、配对仍在  
4. Agent：Check → Download zip → Apply → 确认 version=2.4.6 且 `bound/cloud/printer` 仍为 true  
5. 再跑 PrintJob PENDING→CLAIMED→PRINTED  
6. 测完把 Cloud env **改回 1.0.5 / 2.4.5**，避免门店误升 test 包  

---

## Known Issues

1. 本机 Agent 仍为 **2.4.4**，无法验证 Bootstrap OTA 能力。  
2. 非管理员无法改 ProgramData OTA 配置 / 无法 Apply。  
3. 生产 Cloud 仍返回嵌套 manifest；旧 Agent 会持续 `invalid manifest`（符合预期，需 Bootstrap）。  
4. Client Apply 与升级后 Print 未在本会话执行 — **明确 PENDING，不假设 PASS**。
