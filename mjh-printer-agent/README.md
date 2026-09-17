# MJH Printer Agent

满江红厨房打印代理（V1）：在 Windows 本机运行的 **outbound-only** 云端打印 worker。

云 API 永远不需要主动连入餐厅 PC。Agent 主动轮询领取任务，经 Raw TCP 9100 打到 XP-N160II，再回报完成或失败。

```text
Cloud API
   |
   | HTTPS polling (outbound)
   v
MJH Printer Agent
   |
   | raw TCP 9100
   v
XP-N160II
```

本版本不含 Electron、GUI、安装包、Windows Service 或自动更新。

## 打印机要求（XP-N160II）

- 型号：Xprinter **XP-N160II**
- 连接：Wi-Fi / 同一局域网
- 协议：ESC/POS
- 端口：**TCP 9100**
- 中文：**GB18030**
- 已验证：自动切纸

## 环境

- Windows
- Node.js ≥ 18
- pnpm

## 安装

```bash
cd mjh-printer-agent
pnpm install
```

## 配置

编辑 `config/printer.json`：

```json
{
  "store": {
    "id": "cmu560dok0000jd0vdl6xamjm"
  },
  "agent": {
    "id": "kitchen-1",
    "pollIntervalMs": 3000
  },
  "printer": {
    "name": "Kitchen",
    "model": "XP-N160II",
    "ip": "192.168.0.110",
    "port": 9100,
    "encoding": "gb18030",
    "connectTimeoutMs": 3000
  },
  "cloud": {
    "baseUrl": "http://192.168.0.111:3001/v1"
  }
}
```

**不要**把生产 API token 写进 `printer.json`。

启动 worker 前设置环境变量：

```powershell
$env:MJH_PRINTER_AGENT_TOKEN = "<paste-new-token-locally>"
```

本地幂等状态保存在 `data/print-state.json`（已 gitignore）。若打印成功但云端 complete 失败，重启后**不会重打**，只会重试 ACK。

## 命令

### 本地打印机硬件测试（不访问云）

```bash
pnpm printer:test
```

### 启动云端打印 worker

```powershell
$env:MJH_PRINTER_AGENT_TOKEN = "<paste-new-token-locally>"
pnpm agent:start
```

或使用辅助脚本（同样要求当前会话已设置 token，且不会打印 token 值）：

```powershell
$env:MJH_PRINTER_AGENT_TOKEN = "<paste-new-token-locally>"
.\scripts\start-agent.ps1
```

预期启动日志：

```text
[MJH] Printer Agent starting
[MJH] Store: cmu560dok0000jd0vdl6xamjm
[MJH] Agent: kitchen-1
[MJH] Printer: XP-N160II @ 192.168.0.110:9100
[MJH] Cloud: http://192.168.0.111:3001/v1
[MJH] Waiting for print jobs...
```

有任务时：

```text
[Job pj_xxx] Claimed
[Job pj_xxx] Printer online
[Job pj_xxx] Printing order MJH-...
[Job pj_xxx] Printed
[Job pj_xxx] Cloud acknowledged
```

### 其他

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 排查打印机网络

```powershell
Test-NetConnection 192.168.0.110 -Port 9100
```

## 云端需实现的 API（Agent 侧已按此约定编写）

Agent 只发起出站请求，期望云端提供：

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/printer/jobs/claim` | Body: `{ storeId, agentId }` → `{ job: PrintJob \| null }` |
| `POST` | `/printer/jobs/:jobId/complete` | Body: `{ agentId }` |
| `POST` | `/printer/jobs/:jobId/fail` | Body: `{ agentId, error }` |

Header：`Authorization: Bearer <token>`，`Content-Type: application/json`。

本仓库**不会**修改 NestJS 云端项目；上述接口需在云端另行实现。

## 目录结构

```text
src/
  index.ts              # CLI：printer:test | agent:start
  config.ts
  logger.ts
  printer/
    printer.ts
    escpos.ts
    receipt.ts
  cloud/
    api-client.ts
    types.ts
  jobs/
    worker.ts
    state-store.ts
config/printer.json
data/                   # print-state.json 运行时生成
```
