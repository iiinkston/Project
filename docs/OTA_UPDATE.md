# MJH Printer — Remote OTA Update

## Overview

Two independent OTA paths share the same **manifest API** concept. Neither uses GitHub on restaurant PCs.

### Agent OTA

```
Client / Scheduler
       │
       ▼
Local API (127.0.0.1:17890)
       │
       ├─ GET  /local/update/check
       ├─ GET  /local/update/status
       ├─ POST /local/update/download   → ProgramData\updates\
       └─ POST /local/update/apply      → update-agent.ps1
                                              │
                                              ├─ stop Agent
                                              ├─ SHA256 verify
                                              ├─ replace EXE + rollback
                                              └─ restart task
```

### Client OTA (this release)

```
Client UI (IPC)
       │
       ▼
client-update-service (main process)
       │
       ├─ check   → GET manifest (clientVersion / clientUrl / clientSha256)
       ├─ download → %LOCALAPPDATA%\MJH Printer Client\updates\
       │              SHA256 verify Setup.exe
       └─ apply   → update-client.ps1
                         │
                         ├─ stop Client
                         ├─ Setup.exe /S  (NSIS silent)
                         └─ restart Client
```

Do **not** use `electron-updater`. Do **not** overwrite the running `MJH Printer Client.exe` in place.

---

## Shared remote manifest

`GET {manifestUrl}` → JSON (fields may coexist):

```json
{
  "channel": "stable",
  "agentVersion": "2.4.3",
  "agentUrl": "https://cdn.example.com/releases/MJH-Printer-Agent-2.4.3.exe",
  "sha256": "hex…",
  "clientVersion": "1.0.3",
  "clientUrl": "https://cdn.example.com/releases/MJH-Printer-Setup-1.0.3.exe",
  "clientSha256": "hex…",
  "releaseNotes": "…",
  "mandatory": false
}
```

- Agent reads `agentVersion` / `agentUrl` / `sha256`
- Client reads `clientVersion` / `clientUrl` / `clientSha256`

---

## Agent config

- `C:\ProgramData\MJH Printer Agent\config\update.json`
- or project `mjh-printer-agent/config/update.json`
- override: `MJH_UPDATE_CONFIG_PATH`

```json
{
  "enabled": true,
  "channel": "stable",
  "manifestUrl": "https://api.example.com/printer/update/latest",
  "checkIntervalMinutes": 360
}
```

Default template ships with `"enabled": false`.

### Agent staging

```
C:\ProgramData\MJH Printer Agent\updates\
  MJH-Printer-Agent.exe
  manifest.json
  ota-state.json
```

When remote OTA is enabled, Agent schedules background check/download (default 6h). **Never** auto-applies.

---

## Client config

- `%LOCALAPPDATA%\MJH Printer Client\config\update.json`
- seed from packaged `updater/client-update.json` on first run

```json
{
  "enabled": true,
  "channel": "stable",
  "manifestUrl": "https://api.example.com/printer/update/latest"
}
```

### Client staging

```
%LOCALAPPDATA%\MJH Printer Client\updates\
  MJH Printer Setup.exe
  manifest.json
  ota-state.json
```

### IPC

| Channel | Role |
|---------|------|
| `client:update:check` | compare versions |
| `client:update:download` | download + SHA256 |
| `client:update:apply` | spawn `update-client.ps1`, then quit app |

Apply uses NSIS `/S`. UAC may appear (`RunAs`) because installer is `perMachine`.

---

## Client UI

Settings:

- **Agent 更新** — Local API → Agent OTA
- **Client 更新** — IPC → Client OTA

Statuses are not mixed.

---

## Failure modes

| Case | Behavior |
|------|----------|
| Network down | Keep current binary; `lastError` set |
| Download interrupted | `.partial` removed |
| SHA256 mismatch | Reject; delete download |
| Agent apply failure | `update-agent.ps1` rollback |
| Client apply failure | NSIS / log under LocalAppData logs |

---

## Test commands

```bash
cd mjh-printer-agent
pnpm test
pnpm typecheck

cd ../mjh-printer-client
pnpm test
pnpm typecheck
```

Manual Agent (with manifest URL configured):

```bash
curl http://127.0.0.1:17890/local/update/check
curl http://127.0.0.1:17890/local/update/status
curl -X POST http://127.0.0.1:17890/local/update/download
curl -X POST http://127.0.0.1:17890/local/update/apply
```

Manual Client:

1. Build Client N, publish manifest N+1 with Setup.exe + SHA256
2. Enable `update.json` with `manifestUrl`
3. Settings → 检查 Client 更新 → 下载更新 → 安装更新
4. Confirm version bumped; Agent config / ProgramData unchanged; tray works

---

## Build

```bash
cd mjh-printer-client
pnpm dist:setup
```

Produces NSIS Setup under `dist/client-build/` (or project release path). Package embeds:

- `updater/update-client.ps1`
- `updater/client-update.json`

---

## Security notes

- No GitHub tokens on restaurant PCs
- No `git pull`
- No in-place Electron EXE replace
- No silent forced update (user clicks Install)
- Local Agent API remains `127.0.0.1` only
- Tokens / Authorization stay redacted in Agent logs
