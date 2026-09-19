# MJH Cloud Pairing Patch (`POST /printer/pair`)

本仓库 **不含** NestJS 云端源码（生产在 `206.189.80.83`）。此目录提供可合并补丁。

## 契约（Agent ↔ Cloud）

`POST /api/v1/printer/pair`

```json
{ "pairCode": "MJH-KL-001" }
```

**成功（Agent 私有，一次性）：**

```json
{
  "success": true,
  "storeName": "满江红",
  "agentName": "kitchen-1",
  "storeId": "clxxx...",
  "agentId": "kitchen-1",
  "token": "<plaintext-once>"
}
```

说明：token 只出现在 Cloud→Agent 这一跳；Agent Local API `/local/bind` **禁止**把 token/storeId/agentId 回给 Client。

**失败：** 400 无效码 / 409 已使用 / 404 不存在

## 安全

- pairCode 一次性，用后 `usedAt` 置位
- DB 只存 `token_hash`（SHA-256 hex）
- 日志禁止打印 token / pairCode 明文（可打 hash 前 8 位）

## 合并步骤

1. 应用 `prisma/migration.sql`
2. 复制 `src/*` 到 Nest `printer` 模块并注册路由
3. 或临时运行 `standalone/pair-server.mjs`（需 `DATABASE_URL`）做灰度

## 本地 Mock（Agent 单测 / 无 DB）

```bash
node standalone/mock-pair-server.mjs
# 监听 127.0.0.1:3099 ，预设码 MJH-KL-001
```
