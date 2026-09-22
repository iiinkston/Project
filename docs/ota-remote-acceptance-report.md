# MJH Printer OTA Remote Update — Full Acceptance Report

**Date (UTC):** 2026-09-22  
**Verdict:** **FAIL — 未达到「门店无需技术人员、可长期远程 OTA」**  
**Scope:** 仅测试 / 日志 / 必要 OTA 配置；未改业务代码、Cloud、Docker。

---

## Environment

| Item | Value |
|------|-------|
| Machine | `DESKTOP-1N2OP3S` |
| OS | Windows 11 家庭中文版 10.0.26200 |
| Role | **开发机**（存在 Node / pnpm / Git / 源码）— **不符合** Prompt「非开发 Windows / 禁止 Node·Git·源码」严格门店模拟 |
| Client install | `C:\Program Files\MJH Printer\MJH Printer Client.exe` |
| Agent install | `C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe` |
| Task Scheduler | `MJH Printer Agent`（可启动） |
| Cloud OTA API | `http://206.189.80.83/api/v1/printer/update/latest` |
| Release | `https://github.com/iiinkston/Project/releases/tag/v1.0.4` |

### Phase 0 限制

本机**已是** Client **1.0.4** / Agent **2.4.4**，本地无可用 `1.0.3` / `2.4.3` 安装包，**未能**执行「旧版→新版」真实升级闭环。  
以下结果以 **API / 解析 / 下载 / SHA / 运行时** 验收为主。

---

## Version Before / After

| | Client | Agent |
|--|--------|-------|
| **Before（目标基线）** | 1.0.3（未装上） | 2.4.3（未装上） |
| **Actual start** | **1.0.4** | **2.4.4** |
| **After** | 仍为 1.0.4（未完成 Apply） | 仍为 2.4.4（未完成 Apply） |

Agent runtime（测试结束时）示例：`bound=true`，`cloud.online=true`，`printer.online=true`，`lifecycle=RUNNING`，store=`Man Jiang Hong`。

---

## Cloud Manifest（实测）

`GET http://206.189.80.83/api/v1/printer/update/latest` → **HTTP 200**

```json
{
  "client": {
    "version": "1.0.4",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.4/MJH-Printer-Setup.exe",
    "sha256": "150b537f0d5c8b04e633c41ef9c68d0b83f08837fbbf8cb05f59c3c2f5b5de5e"
  },
  "agent": {
    "version": "2.4.4",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.4/MJH-Printer-Agent-v2.4.4.zip",
    "sha256": "33693ab52c886e653f9cd3559780784cb28668f76c7c1874698c100acc3fb881"
  }
}
```

---

## Test Result

| Item | Result | Evidence |
|------|--------|----------|
| Manifest API | **PASS** | HTTP 200，返回 client/agent 字段 |
| Client Check | **FAIL** | 客户端期望扁平 `clientVersion/clientUrl/clientSha256`；Cloud 为嵌套 `client.version/url/sha256` → `manifest missing clientVersion` |
| Client Download | **BLOCKED** | Check 失败，无法进入正规 Download 流程 |
| Client SHA256 | **FAIL**（相对 Cloud 声明） | 匿名下载 Setup 实测 SHA256 = `b6314b9989f2e5dedd17d59d97fca9278b85a38c6f019c32f620a0e57c9289b1`，**≠** Cloud `150b537f…` |
| Client Upgrade | **FAIL / 未测到 Apply** | 无旧版基线；Check/Download 未过 |
| Agent Check | **FAIL** | `remoteEnabled=true` 后 Check：`invalid manifest` 缺 `agentVersion` / `agentUrl` / `sha256`（同为嵌套 schema） |
| Agent Download | **FAIL** | `POST /local/update/download` → **HTTP 400**（manifest 无效） |
| Agent SHA256 | **FAIL**（相对 Cloud 声明） | 匿名下载 zip 实测 = `8acba63f58dc28ec863ee267e929910089876a167240b90cfbce34ebce9fb9e9`，**≠** Cloud `33693ab5…` |
| Agent Upgrade | **FAIL / 未测到 Apply** | Download 未就绪；且 Cloud URL 为 **.zip**，Agent OTA 落盘为 **`MJH-Printer-Agent.exe`**（包形态不匹配） |
| Binding Preserve | **N/A（未升级）** | 当前已绑定态 **PASS**：`bound=true`，无需重输 MJH-001 |
| Printer Online | **PASS**（当前运行态） | `printer.online=true`，XP-N160II `192.168.0.110:9100` |
| PrintJob Flow | **NOT RUN** | 未下测试单；日志曾见 Cloud claim **502 / timeout**（与 OTA 升级无关） |

---

## Phase 细节

### Phase 1 — OTA 配置

已写入（允许的配置调整）：

- `%LOCALAPPDATA%\MJH Printer Client\config\update.json` → `enabled=true` + manifestUrl  
- `C:\ProgramData\MJH Printer Agent\config\update.json` → 同上  

**发现：** PowerShell `Set-Content -Encoding utf8` 会写 **UTF-8 BOM**，导致 Agent `JSON.parse` 失败并回落 `enabled=false`（日志：`OTA scheduler idle (remote update disabled)`）。改为无 BOM UTF-8 后 `remoteEnabled=true`。

### Phase 2–3 — Client OTA

- 解析 Cloud JSON：**FAIL**（字段名/结构不兼容）  
- 即便手工映射为扁平字段，Cloud 声明的 SHA256 与 GitHub 文件不一致 → Download 后校验会 **拒绝安装**（符合安全设计，但阻断升级）

### Phase 4–5 — Agent OTA

- Check：`lastError` 含 Zod `agentVersion` / `agentUrl` / `sha256` Required  
- Download：HTTP 400  
- 额外风险：manifest 指向 **zip**，Agent downloader 固定写 **exe**

### Phase 6 — Runtime（当前 2.4.4）

`GET http://127.0.0.1:17890/local/status`：

- `bound=true`  
- `cloud.online=true`  
- `printer.online=true`  

### Phase 7 — 打印

未执行正式 PrintJob E2E（本验收优先阻断项为 OTA 链路）。

### 异常项（部分）

| 异常 | 结果 |
|------|------|
| 断网 Check | 未单独压测；预期应失败提示而非崩溃（Client 侧既有 try/catch） |
| SHA256 错误拒绝 | **逻辑上 PASS**：Cloud hash ≠ 实文件时客户端会拒装（一旦 schema 修好即可验证） |
| PID lock | 本次未走到 Apply；此前 2.4.4 已修 PID reuse |
| 重启机器 | **未执行** |

---

## Issues Found（按优先级）

1. **Cloud Manifest schema 与 Client/Agent 不兼容（阻断）**  
   - Cloud：`{ client:{version,url,sha256}, agent:{...} }`  
   - Client：`clientVersion` / `clientUrl` / `clientSha256`  
   - Agent：`agentVersion` / `agentUrl` / `sha256`

2. **Cloud 声明的 SHA256 与 GitHub Release 实文件不一致（阻断）**  
   - Client Setup 实文件：`b6314b9989f2e5dedd17d59d97fca9278b85a38c6f019c32f620a0e57c9289b1`  
   - Agent zip 实文件：`8acba63f58dc28ec863ee267e929910089876a167240b90cfbce34ebce9fb9e9`

3. **Agent 包形态不匹配（阻断）**  
   - Cloud URL 为 `.zip`；Agent OTA 期望可执行 `MJH-Printer-Agent.exe` 内容。

4. **无法验证旧版→新版闭环**  
   - 缺 1.0.3 / 2.4.3 门店基线安装包；当前机已是目标版本。

5. **Agent `update.json` BOM 运维陷阱**  
   - 手写配置易导致 OTA「看起来开了其实没开」。

6. **环境不符合「纯门店机」**  
   - 本报告在开发机执行，结论偏工程验收，非洁净机验收。

7. **正面进展**  
   - GitHub `releases/download/v1.0.4/...` **现可匿名下载（HTTP 200）**（相对此前私有仓 404 已改善）。

---

## 是否达到门店长期远程 OTA？

**否。**

在 Cloud Manifest 修正为：

1. 客户端/Agent 可解析的字段结构，  
2. 与公开下载文件一致的 SHA256，  
3. Agent 提供 **EXE**（或 Agent 支持 zip），  

并在 **洁净 Windows + 旧版 1.0.3/2.4.3** 上重跑 Apply / 打印 / 重启 之前，**不能**认定「门店装包后可无人值守远程维护」。

---

## 建议的下一步（仅建议，本报告未改代码）

1. Cloud `/printer/update/latest` 输出扁平字段（或同时兼容嵌套+扁平）。  
2. 用本报告实文件 hash 更新 Cloud SHA256（或重新上传匹配 hash 的资产）。  
3. Agent OTA URL 改为 `MJH-Printer-Agent.exe`（从 zip 抽出后单独发布）。  
4. 准备 `1.0.3` Setup + `2.4.3` Agent，在无开发工具的 Windows 上重跑本 Prompt。

---

## 附件路径

- 匿名下载副本：`D:\Project\docs\rc-reports\ota-acceptance\download\`  
- 本报告：`D:\Project\docs\ota-remote-acceptance-report.md`
