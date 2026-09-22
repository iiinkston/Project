# MJH Printer Final OTA Production Validation

**Date (UTC):** 2026-09-22  
**Final Decision:** **NOT READY** — 升级闭环部分真实通过，但未满足洁净门店机约束；且已发布 Agent 的 Local API Apply **未提权**会导致空成功（源码已修，需下一版随包发布）。

禁止假设 PASS：凡未真实执行的步骤均标 **PENDING**。

---

## Environment

| Item | Value |
|------|-------|
| Windows | Windows 11 家庭中文版 10.0.26200 (x64) |
| Machine | DESKTOP-1N2OP3S |
| Role | **开发机**（Git / Node / pnpm / Cursor **均存在**） |
| Store-clean gate | **FAIL**（Prompt 要求禁止 Git/Node/IDE） |
| Printer | XP-N160II `192.168.0.110:9100` |

---

## Before

| Component | Version / state |
|-----------|-----------------|
| Client | **1.0.4**（`client.log` `version=1.0.4`） |
| Agent | **2.4.4** → 经 Bootstrap 升到 **2.4.5** |
| Binding | `bound=true`, store=`Man Jiang Hong` |
| Cloud / Printer | online / online |

---

## After

| Component | Version / state |
|-----------|-----------------|
| Client | **1.0.6**（`client.log` `app start version=1.0.6`）— **不是**字面量 `1.0.6-test`（包内 semver 为 1.0.6） |
| Agent | **2.4.6**（`MJH-Printer-Agent.exe version` + `/local/status`） |
| Binding | `bound=true`, `cloud.online=true`, `printer.online=true`, store=`Man Jiang Hong` |

证据目录：`docs/rc-reports/ota-final-acceptance/`

---

## OTA Result

| Test | Result | Notes |
|------|--------|-------|
| Manifest | **PASS*** | *本机用 `127.0.0.1:18766/manifest` 模拟嵌套 Cloud；**生产 Cloud 仍指向 1.0.5/2.4.5**，未改 Cloud API 代码。临时切到 v1.0.6-test = **PENDING（运维）** |
| Client Check | **PENDING** | 未走 UI Settings→Check；1.0.4 对嵌套 Cloud 曾报 `manifest missing clientVersion` |
| Client Download | **PASS** | `%LOCALAPPDATA%\MJH Printer Client\updates\MJH Printer Setup.exe` SHA = `503d0aad…7495a1` |
| Client SHA | **PASS** | 与 v1.0.6-test 声明一致 |
| Client Apply | **PASS** | elevated `update-client.ps1 -SetupPath` → Setup exit=0 → 日志 `version=1.0.6` |
| Agent Download | **PASS** | 2.4.5 Local API：nested check → GitHub zip → SHA → extract → stage EXE |
| Agent SHA | **PASS** | zip `ee34c649…797c8d`；staged EXE 与 Release 内 EXE 同 hash |
| Agent Apply | **PASS*** / **FAIL*** | *elevated `update-agent.ps1 -Source staged` → **2.4.6** + binding 保持 = **PASS**。<br>*未提权 Local API `POST /local/update/apply`：返回 ok 但 EXE 仍 2.4.5 = **FAIL**（根因：`#Requires -RunAsAdministrator`） |
| Binding Preserve | **PASS** | Apply 后仍 `bound=true` / cloud / printer online；doctor Token=YES |
| Restart Recovery | **PENDING** | **未执行** Windows 重启 |
| Print E2E | **PASS*** | *`POST /local/printer/test` ok=true（硬件+V2 demo）。完整订单 PENDING→CLAIMED→PRINTED **PENDING**（未下 Cloud 正式单） |
| Failure: bad SHA | **PENDING** | 本轮未改生产/本地 manifest 做拒装；既有单测覆盖 |
| Failure: network cut | **PENDING** | 未测 |
| Failure: restart/rollback | **PENDING** | 未故意制造失败；elevated 成功路径未触发 rollback |

---

## Cloud Manifest

生产 `GET http://206.189.80.83/api/v1/printer/update/latest` 实测仍为 Bootstrap：

- client `1.0.5` / sha `38a215f6…`  
- agent `2.4.5` / sha `5783fe1d…`  

临时切到 v1.0.6-test 的 env 值见 `docs/ota-real-upgrade-test-v1.0.6.md`。**本轮未写入生产 Cloud**（禁止改 Cloud API；配置权在运维）。

注意：Manifest **version 字段**应使用 `1.0.6` / `2.4.6`（与包内 semver 一致），勿用 `1.0.6-test` 作为 version，否则升级后可能永远 “有更新”。

---

## Necessary fix（本轮允许的修复）

**问题：** `update-agent.ps1` 要求管理员；Local API `spawn` 未提权 → Apply 空成功。  

**修复：** `mjh-printer-agent/src/local/update.ts` — 通过 `Start-Process -Verb RunAs` 启动更新脚本。  

**状态：** 源码已改；**已安装的 2.4.6 Release 二进制尚不含此修复** → 需后续 patch 发布后，门店 Local API Apply 才可靠。

---

## Final Decision

是否达到：

> 「门店安装一次 Setup 后，可长期远程 OTA 维护」

**现阶段：否（NOT READY）。**

理由：

1. 验收机不是洁净门店环境。  
2. 生产 Cloud 未切到测试包做端到端 Manifest。  
3. Windows 重启恢复 **PENDING**。  
4. Cloud PrintJob 全链路 **PENDING**。  
5. 已发布包的 **Apply 提权缺陷** 需随下一 Agent 版本发布后，再在洁净机复测一次 Local API Apply。

### 已证明可用的部分

- Bootstrap Agent **2.4.5** 可消费嵌套 Manifest + zip OTA（下载/校验/解压）。  
- Elevated Apply 可将 Agent **2.4.5→2.4.6** 并保持绑定与打印机在线。  
- Client **→1.0.6** 可通过 staged Setup + `update-client.ps1 -SetupPath` 完成。  
- 升级后本地打印测试 **PASS**。

### 门店部署前最小复测清单

1. 洁净 Windows（无开发工具）装 Bootstrap **1.0.5 Setup**。  
2. Cloud env 临时指向 v1.0.6-test（version 用 `1.0.6`/`2.4.6`）。  
3. 发布含 Apply 提权修复的 Agent，再测 UI/LocalAPI Apply（确认 UAC）。  
4. 重启 Windows + 一笔真实 PENDING→CLAIMED→PRINTED。  
5. 测完 Cloud 改回稳定版。
