# Unified Windows Installer Validation

Store deployment uses **one** installer:

`MJH-Printer-Setup.exe`

Internally it still installs **two processes**:

| Component | Path | Role |
|-----------|------|------|
| Client | `C:\Program Files\MJH Printer\MJH Printer Client.exe` | User-session Electron UI |
| Agent | `C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe` | Background Local API + print worker |

OTA remains independent (nested Cloud manifest `client` / `agent`).

## Architecture

```
Agent:  pnpm test && pnpm typecheck && pnpm build:exe
          → mjh-printer-agent/release/*

Client: node installer/stage-agent.mjs
          → mjh-printer-client/installer/agent-release/*
        pnpm dist:setup (electron-builder NSIS)
          → dist/client-build/MJH Printer Setup.exe
CI rename → release/MJH-Printer-Setup.exe
```

NSIS `customInstall` (`installer/nsis-agent.nsh`):

1. Run staged `agent-release/install.ps1`  
   - Agent binaries + `MJH Printer Agent` task + `MJH Printer Agent Update` task  
   - Preserves existing `C:\ProgramData\MJH Printer Agent\config`
2. Register `MJH Printer Client Update`
3. `launch-client-after-install.ps1`  
   - Poll `http://127.0.0.1:17890/local/health` (30 × 1s)  
   - On success: launch Client in **interactive user session** (not Session 0)  
   - On failure: write `C:\ProgramData\MJH Printer Client\logs\installer-start.log`  
     and show: `打印服务启动失败，请重新启动电脑或联系技术支持。`

Windows ARP / shortcut display name: **满江红打印助手**.

Uninstall (default): remove Client + Agent binaries + all three scheduled tasks; **preserve** Agent ProgramData config (token / store / printer). Use Agent `uninstall.ps1 -PurgeData` only when intentionally wiping binding.

## CI gate

```powershell
.\scripts\validate-unified-installer.ps1 `
  -ExpectedClientVersion <tag-client> `
  -ExpectedAgentVersion <agent-package> `
  -SetupPath dist\client-build\MJH Printer Setup.exe `
  -AgentReleaseDir mjh-printer-client\installer\agent-release
```

Wired in `.github/workflows/ota-release.yml` after `pnpm dist:setup`.

## Fresh install acceptance

Preconditions: no prior Client/Agent install (or clean uninstall without `-PurgeData` only if re-pair is expected).

1. Run only `MJH-Printer-Setup.exe` (UAC elevate). No PowerShell / Git / Node on store PC.
2. Expect:
   - Client under `C:\Program Files\MJH Printer\`
   - Agent under `C:\Program Files\MJH Printer Agent\`
   - Tasks: `MJH Printer Agent`, `MJH Printer Agent Update`, `MJH Printer Client Update`
   - `GET http://127.0.0.1:17890/local/health` → healthy
   - Client window visible in logged-in user session (满江红打印助手)
3. Pair with store code (e.g. `MJH-001`) only if Agent unbound.
4. 打印机设置 → 自动扫描 → select XP-N160II → 测试打印.
5. Scanner must use **current adapter /24** (e.g. PC `192.168.1.117/24` → scan `192.168.1.0/24`), not hard-coded `192.168.0.0/24`.

Record: Setup path, SHA256, health JSON, task list, screenshot of Client UI.

## Upgrade acceptance

Existing: Client 1.0.14 + Agent 2.4.8 (paired + printer configured).

1. Install newer unified Setup over existing install.
2. Expect:
   - No re-pair prompt
   - Same `agent.token` / store binding / printer IP in ProgramData
   - Agent healthy; Client healthy; test print still works
   - Missing scheduled tasks recreated if needed

## Reboot acceptance

1. Restart Windows.
2. Expect Agent auto-starts via `MJH Printer Agent` AtStartup task.
3. Client can reconnect to Local API; Cloud reconnects; printer status recovers.

## Local validation checklist

| Check | Command / evidence |
|-------|--------------------|
| Static packaging gate | `validate-unified-installer.ps1` exit 0 |
| Agent unit (discover) | `cd mjh-printer-agent && pnpm test` |
| Client OTA unit | `cd mjh-printer-client && pnpm test` |
| Health after install | `Invoke-WebRequest http://127.0.0.1:17890/local/health` |
| Installer log | `C:\ProgramData\MJH Printer Client\logs\installer-start.log` |
| Config preserved | `C:\ProgramData\MJH Printer Agent\config\printer.json` unchanged token/IP |

## Results log (RC / local)

| Scenario | Result | Notes |
|----------|--------|-------|
| Static packaging gate | **PASS** | `validate-unified-installer.ps1` client=1.0.15 agent=2.4.9 |
| Agent unit tests | **PASS** | 122/122 including store-style `192.168.1.117` diagnostics |
| Client OTA unit tests | **PASS** | 34/34 |
| Rebuild Agent + `pnpm dist:setup` | **PASS** | Agent 2.4.9 allowlist embedded; no nested zip; no `192.168.0.110` |
| Physical print / QR E2E | **STATIC PASS / STORE TEST REQUIRED** | Printer is at restaurant — see `docs/store-deployment-malaysia.md` |
| Fresh / Upgrade / Reboot on store PC | **STORE TEST REQUIRED** | Deliver `MJH-Printer-Setup.exe` to owner |
| Final Setup path | `D:\Project\release\MJH-Printer-Setup.exe` | |
| Final Setup SHA256 | `0572ee7420fa0d826ae58e75ba069a54347b1b876209f901c3303b22f6d6ea20` | Client 1.0.15 |
| Agent OTA zip | `D:\Project\release\MJH-Printer-Agent-v2.4.9.zip` | SHA256 `884eda8b60a64c775f193894bda4abf01701d0c343a60c18d6ad4338acaa5445` |

## Production risks

- Silent `/S` OTA Setup suppresses the Chinese MessageBox but still skips Client launch and writes `installer-start.log` when health fails.
- Store PCs with only VPN adapters may pick a non-kitchen subnet; prefer real Ethernet/Wi-Fi with default gateway.
- Committed `installer/agent-release/` can drift until `stage-agent.mjs` / CI `dist:setup` refreshes it from `mjh-printer-agent/release`.
