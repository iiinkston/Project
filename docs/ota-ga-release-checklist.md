# MJH Printer — OTA GA Release Checklist

生产化收尾清单。**不要在开发机上做最终 GA 判定。**

---

## 0. 版本一致性（合并前）

```powershell
powershell -File scripts/validate-release-versions.ps1 -WorkspaceRoot .
powershell -File scripts/get-version.ps1
```

必须：

| 字段 | 要求 |
|------|------|
| `mjh-printer-client/package.json` → `version` | 正式 semver，如 `1.0.8` |
| `build.buildVersion` / `extraMetadata.version` | **不要写死**；若存在必须 = `package.json` version |
| `mjh-printer-agent/package.json` → `version` | 正式 semver，如 `2.4.8`（可与 Client 不同） |
| Git tag | `vX.Y.Z`，**禁止**含 `test` |

CI 在 `OTA Release` 开头跑同一 gate；不一致则 **fail**。

---

## 1. 删除测试 Release

正式发版前确认已删除：

- Tag / Release：`v-test-release`

```bash
gh release delete v-test-release --yes
git push origin :refs/tags/v-test-release
git tag -d v-test-release
```

---

## 2. 配置 Cloud `REMOTE_MANIFEST_URL`

生产 Cloud **优先**使用远程元数据，不再每次改 `CLIENT_*` / `AGENT_*` env。

发版后将：

```env
REMOTE_MANIFEST_URL=https://github.com/iiinkston/Project/releases/download/v1.0.8/release-metadata.json
```

（把 `v1.0.8` 换成当次 tag。）

可选保留 ENV 作为冷备（provider 在远程失败且无缓存时回退）。

验证：

```text
GET http://<cloud>/api/v1/printer/update/latest
→ { "client": { version, url, sha256 }, "agent": { … } }
```

与 Release `release-metadata.json` 一致。

---

## 3. 正式打 tag 发布

```bash
# package.json 已 bump 并提交
git tag v1.0.8
git push origin v1.0.8
```

等待 Actions **OTA Release** success，确认 3 资产：

- `MJH-Printer-Setup.exe`
- `MJH-Printer-Agent-v{agentVersion}.zip`
- `release-metadata.json`

SHA：下载资产后与 metadata 比对。

更新生产 `REMOTE_MANIFEST_URL` 指向新 Release metadata。

---

## 4. 洁净机 GA（机器 A）

| 步骤 | 期望 |
|------|------|
| 干净 Windows，无 Git/Node/IDE | — |
| 安装当前稳定 Setup（如 1.0.7 / 内嵌 Agent） | Client 起、Agent 任务、绑定、打印 PASS |
| Cloud 切到新 manifest（如 Client 1.0.8 / Agent 2.4.9） | — |
| Client / Agent 发现更新 | `updateAvailable=true`，**不**提示降级 |
| 下载 → SHA → Apply → 重启 | 版本升到目标，绑定保留 |
| 再打印 | PASS |
| 可选：故意把 manifest 改回旧版 | 门店 **忽略降级**，保持当前版本 |

开发机结果只能作冒烟，**不能**标 READY。

---

## 5. 防降级（已内置）

Client / Agent：

```text
仅当 remoteVersion > currentVersion 才下载/提示更新
同版本或更低 → ignore
```

---

## 6. 代码签名（GA 后排期）

当前 CI `signing skipped`。门店 SmartScreen 风险已知；购买证书后再签 Setup + Agent EXE。

---

## 7. READY 判定

同时满足才可标 **GA READY**：

- [ ] 版本 gate + metadata gate 绿
- [ ] 无测试 tag 污染
- [ ] `REMOTE_MANIFEST_URL` 指向正式 Release metadata
- [ ] 洁净机完整 OTA + 打印 PASS
- [ ] 降级 ignored 已验证（可选但推荐）
