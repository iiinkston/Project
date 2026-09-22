# OTA Release 准备报告 — v1.0.4

检查时间（UTC）：2026-09-22T05:43Z  
仓库：`iiinkston/Project`  
范围：仅验证 Release Pipeline / Assets / Hash（未改任何代码）

---

## 1. Workflow

文件：`.github/workflows/release.yml`

| 检查项 | 结果 |
|--------|------|
| Tag trigger `push.tags: v*` | **PASS** |
| 最近一次 run | [35687823864](https://github.com/iiinkston/Project/actions/runs/35687823864) |
| status / conclusion | `completed` / **`success`** |
| tag | `v1.0.4` |
| commit | `c3a1e04` |

---

## 2. GitHub Release

| 项 | 值 |
|----|-----|
| Release URL | https://github.com/iiinkston/Project/releases/tag/v1.0.4 |
| name | MJH Printer v1.0.4 |
| draft / prerelease | false / false |
| published_at | 2026-09-22T04:45:07Z |
| assets | **4**（均 `state=uploaded`） |

### Asset 列表

| Asset | Size | 要求 |
|-------|------|------|
| `MJH-Printer-Setup.exe` | 97,115,825 | **必有 — PASS** |
| `MJH-Printer-Agent-v2.4.4.zip` | 21,931,207 | **必有 — PASS**（实际文件名带 `v`） |
| `MJH-Printer-Agent-v2.4.4-win-x64.zip` | 21,931,207 | 额外副本 — PASS |
| `release-metadata.json` | 652 | **必有 — PASS** |

---

## 3. 下载地址

| URL | 认证下载 | 匿名访问 |
|-----|----------|----------|
| https://github.com/iiinkston/Project/releases/download/v1.0.4/MJH-Printer-Setup.exe | **PASS**（API + token） | **FAIL HTTP 404**（私有仓库） |
| https://github.com/iiinkston/Project/releases/download/v1.0.4/MJH-Printer-Agent-v2.4.4.zip | **PASS** | **FAIL HTTP 404** |
| https://github.com/iiinkston/Project/releases/download/v1.0.4/release-metadata.json | **PASS** | **FAIL HTTP 404** |

`release-metadata.json` 内容摘要：

- `version`: `v1.0.4`
- `clientVersion`: `1.0.4`
- `agentVersion`: `2.4.4`
- `downloadUrl.client`: Setup URL（同上）
- `downloadUrl.agent`: `.../MJH-Printer-Agent-v2.4.4-win-x64.zip`

---

## 4. SHA256（本地对已下载产物）

```
CLIENT_UPDATE_SHA256=b6314b9989f2e5dedd17d59d97fca9278b85a38c6f019c32f620a0e57c9289b1
AGENT_UPDATE_SHA256=8acba63f58dc28ec863ee267e929910089876a167240b90cfbce34ebce9fb9e9
```

对应文件：

- Client: `MJH-Printer-Setup.exe`
- Agent: `MJH-Printer-Agent-v2.4.4.zip`（非 `MJH-Printer-Agent-2.4.4.zip`）

本地副本：`D:\Project\docs\rc-reports\ota-release-check\download\`

---

## 5. 是否可进入 Cloud manifest 配置阶段？

| 维度 | 结论 |
|------|------|
| Pipeline / Release 创建成功 | **是** |
| OTA 所需三类资产齐全 | **是** |
| Hash 已算好，可填 manifest | **是** |
| 门店 PC **匿名**直连 GitHub download URL | **否**（私有仓 404） |

**结论：可以进入 Cloud manifest「配置草稿」阶段**（版本号 + URL 字段 + SHA256 已就绪）。  
但 **生产 OTA 不能直接使用当前私有 GitHub `releases/download/...` URL**——门店无法拉取。下一步需把同一批文件挂到门店可达的 CDN/Update API（或公开 Release / 带鉴权的代理），manifest 里的 `clientUrl` / `agentUrl` 指向那个可达地址，并继续使用上表 SHA256。

---

## 建议的 manifest 字段草稿（URL 待换成公开 CDN）

```json
{
  "clientVersion": "1.0.4",
  "clientUrl": "<PUBLIC_CDN>/MJH-Printer-Setup.exe",
  "clientSha256": "b6314b9989f2e5dedd17d59d97fca9278b85a38c6f019c32f620a0e57c9289b1",
  "agentVersion": "2.4.4",
  "agentUrl": "<PUBLIC_CDN>/MJH-Printer-Agent-v2.4.4.zip",
  "sha256": "8acba63f58dc28ec863ee267e929910089876a167240b90cfbce34ebce9fb9e9",
  "releaseNotes": "MJH Printer Platform v1.0.4"
}
```

> 注意：Agent OTA 现有实现通常消费的是 **EXE + sha256**，不是 zip。若 Update API 需要 Agent EXE，请从 zip 内取出 `MJH-Printer-Agent.exe` 再算一次 EXE 的 SHA256 后写入 `agentUrl`/`sha256`。本次按你的要求只验证了 Release 中的 **Setup.exe** 与 **Agent zip**。
