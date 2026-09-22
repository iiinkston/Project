# OTA Real Upgrade Test Package — v1.0.6

**Tag:** `v1.0.6-test`  
**Purpose:** 从 Bootstrap **Client 1.0.5 / Agent 2.4.5** 做一次真实远程 OTA 升级验证。  
**Date (UTC):** 2026-09-22  
**Scope:** 仅测试版本 + 验证；未改 Cloud API / Pairing / DB / Print Worker 业务逻辑。

---

## Target versions

| Package | Version |
|---------|---------|
| Client | **1.0.6** |
| Agent | **2.4.6** |

---

## Release assets

| Asset | SHA256 |
|-------|--------|
| `MJH-Printer-Setup.exe` | `503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1` |
| `MJH-Printer-Agent-v2.4.6.zip` | `ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d` |

```
CLIENT_UPDATE_SHA256=503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1
AGENT_UPDATE_SHA256=ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d
```

Download base:

`https://github.com/iiinkston/Project/releases/download/v1.0.6-test/`

---

## Cloud Manifest（临时测试配置）

将生产 `.env.production` **临时**改为（或等价 Update API 配置）：

```env
CLIENT_VERSION=1.0.6
CLIENT_UPDATE_URL=https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe
CLIENT_UPDATE_SHA256=503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1

AGENT_VERSION=2.4.6
AGENT_UPDATE_URL=https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Agent-v2.4.6.zip
AGENT_UPDATE_SHA256=ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d
```

期望 `GET /v1/printer/update/latest`：

```json
{
  "client": {
    "version": "1.0.6",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe",
    "sha256": "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1"
  },
  "agent": {
    "version": "2.4.6",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Agent-v2.4.6.zip",
    "sha256": "ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d"
  }
}
```

测试结束后请改回 Bootstrap **1.0.5 / 2.4.5**（见 `docs/ota-release-v1.0.5.md`），避免门店误升到 test 包。

---

## Prerequisites

1. 门店机已安装 Bootstrap：**Client 1.0.5 + Agent 2.4.5**（含 nested/zip/BOM 兼容层）  
2. `update.json` 已 `enabled=true` 且 `manifestUrl` 指向 Cloud（或本机临时 manifest）  
3. 测试前确认 `bound=true` / `cloud.online=true` / `printer.online=true`

---

## Validation checklist

见 `docs/ota-real-upgrade-validation-report.md`。
