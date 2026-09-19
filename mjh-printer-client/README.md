# 满江红打印助手（Printer Client）

Electron + React 控制面板。通过本机 Agent Local API 管理打印机，**不直连打印机、不展示 token**。

## 要求

- 已安装并运行 **MJH Printer Agent ≥ 2.2.0**（监听 `http://127.0.0.1:17890`）

## 开发

```powershell
cd D:\Project\mjh-printer-client
pnpm install
pnpm electron:dev
```

## 功能

- 首页：服务 / 云端 / 打印机状态、测试打印
- 打印机：改 IP、扫描局域网 :9100
- 日志：最近 100 行（Agent 脱敏）

本阶段不做 Installer。
