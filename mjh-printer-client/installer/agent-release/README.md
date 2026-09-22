# 满江红打印机代理 MJH Printer Agent v2.4.4

Build: `2026-09-22T03:50:08Z`

## 安装（管理员 PowerShell）

```powershell
cd <本目录>
.\install.ps1
```

## 升级

```powershell
.\update-agent.ps1 -Source ".\MJH-Printer-Agent.exe"
```

## 诊断

```powershell
.\MJH-Printer-Agent.exe version
.\MJH-Printer-Agent.exe doctor
.\MJH-Printer-Agent.exe agent:diagnose
.\MJH-Printer-Agent.exe agent:start --dry-run
```
