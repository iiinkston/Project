# MJH Printer OTA Bootstrap Release — v1.0.5

**Purpose:** 首个包含完整 OTA 兼容能力的门店基础版本（Bootstrap）。  
**Date (UTC):** 2026-09-22

| Package | Version |
|---------|---------|
| Client Setup | **1.0.5** |
| Agent | **2.4.5** |
| GitHub tag | **v1.0.5** |

此后门店首次部署用 Setup.exe；后续仅靠 Cloud Manifest OTA。

---

## Why not v1.0.4 / 2.4.4

已发布的 v1.0.4 二进制**不含**：

- nested Cloud manifest parser
- Agent zip → EXE staging
- `update.json` UTF-8 BOM 兼容

因此 **不能**作为后续 OTA 基线。请用 **1.0.5 / 2.4.5** 做首次装机。

---

## Release assets

| Asset | Notes |
|-------|-------|
| `MJH-Printer-Setup.exe` | Client 1.0.5 + 内嵌 Agent 2.4.5 |
| `MJH-Printer-Agent-v2.4.5.zip` | 独立 Agent 包 |
| `release-metadata.json` | 版本 + SHA256 |

Download base:

`https://github.com/iiinkston/Project/releases/download/v1.0.5/`

---

## SHA256（certutil 实测）

```
CLIENT_UPDATE_SHA256=38a215f6efda13b1444f51c7250e0510c94be383d254646c2631fc5d781dfdbd
AGENT_UPDATE_SHA256=5783fe1d2928831ca973a5a680b0e47666a5405fa276a6acd8708fcb49512e8f
```

要求：64 hex、小写、无空格、无换行。

---

## Cloud `.env.production`（运维粘贴）

变量名以 Cloud 实际为准，映射到 `GET /v1/printer/update/latest` 嵌套字段：

```env
CLIENT_VERSION=1.0.5
CLIENT_UPDATE_URL=https://github.com/iiinkston/Project/releases/download/v1.0.5/MJH-Printer-Setup.exe
CLIENT_UPDATE_SHA256=38a215f6efda13b1444f51c7250e0510c94be383d254646c2631fc5d781dfdbd

AGENT_VERSION=2.4.5
AGENT_UPDATE_URL=https://github.com/iiinkston/Project/releases/download/v1.0.5/MJH-Printer-Agent-v2.4.5.zip
AGENT_UPDATE_SHA256=5783fe1d2928831ca973a5a680b0e47666a5405fa276a6acd8708fcb49512e8f
```

期望 API 形状（保持嵌套，勿改 Cloud API）：

```json
{
  "client": {
    "version": "1.0.5",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.5/MJH-Printer-Setup.exe",
    "sha256": "38a215f6efda13b1444f51c7250e0510c94be383d254646c2631fc5d781dfdbd"
  },
  "agent": {
    "version": "2.4.5",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.5/MJH-Printer-Agent-v2.4.5.zip",
    "sha256": "5783fe1d2928831ca973a5a680b0e47666a5405fa276a6acd8708fcb49512e8f"
  }
}
```

更新 env 后重启 Cloud 进程 / 确认 API 返回新值。

---

## 门店首次部署

1. 下载并运行 `MJH-Printer-Setup.exe`（管理员）  
2. 完成配对（MJH-001 等）  
3. 确认 Client 显示 **1.0.5**，Agent `version` **2.4.5**  
4. 写入 `update.json`（`enabled=true` + Cloud manifestUrl），**建议无 BOM UTF-8**（1.0.5 已兼容 BOM）  
5. 之后只改 Cloud env 即可推 OTA

---

## 下一版本迭代（例 v1.0.6）

```
git tag v1.0.6
→ GitHub Actions Release
→ 更新 Cloud env（VERSION / URL / SHA256）
→ 门店自动 Check / Download / Apply
```

无需再上门装机（除非 Bootstrap 未装到 1.0.5）。
