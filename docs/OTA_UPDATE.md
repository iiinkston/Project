# MJH Printer Agent — Remote OTA Update

## Overview

OTA extends the existing **local** updater. It does **not** rewrite `update-agent.ps1`.

```
Client / Scheduler
       │
       ▼
Local API (127.0.0.1:17890)
       │
       ├─ GET  /local/update/check      → remote manifest (optional) + local compare
       ├─ GET  /local/update/status     → current / latest / downloaded / ready
       ├─ POST /local/update/download   → fetch EXE → ProgramData\updates\
       └─ POST /local/update/apply      → existing update-agent.ps1
                                              │
                                              ├─ stop Agent
                                              ├─ SHA256 verify install copy
                                              ├─ replace EXE + rollback
                                              └─ restart task
```

Customer PCs never talk to GitHub. They only use:

1. Your **manifest API** (`manifestUrl`)
2. Your **CDN / storage** URL from the manifest (`agentUrl`)

## Config

File (not `printer.json`):

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

Default template ships with `"enabled": false` so existing installs stay local-only until you configure a URL.

## Remote manifest

`GET {manifestUrl}` → JSON:

```json
{
  "channel": "stable",
  "agentVersion": "2.4.3",
  "agentUrl": "https://cdn.example.com/releases/MJH-Printer-Agent-2.4.3.exe",
  "sha256": "hex…",
  "releaseNotes": "…",
  "mandatory": false
}
```

## Staging layout

After a successful download:

```
C:\ProgramData\MJH Printer Agent\updates\
  MJH-Printer-Agent.exe
  manifest.json          ← local staged manifest (consumed by existing updater)
  ota-state.json         ← last check / ready flags
```

SHA256 is verified **before** rename from `.partial`. Mismatch deletes the file and aborts.

## Scheduler

When remote OTA is enabled, Agent starts a background timer (default **6 hours**):

1. Check manifest
2. If newer and not yet staged → download in background
3. **Never** auto-applies (printing is not interrupted by install)

Install remains explicit via Client **安装更新** or `POST /local/update/apply`.

## Client UI

Settings → Agent 更新:

- 当前版本 / 最新版本
- **检查更新**
- **下载更新**
- **安装更新** (only when `ready=true`)

## Failure modes

| Case | Behavior |
|------|----------|
| Network down | Keep current EXE; retry later; `lastError` set |
| Download interrupted | `.partial` removed |
| SHA256 mismatch | Reject; delete download |
| Apply failure | Existing `update-agent.ps1` rollback |

## Test commands

```bash
cd mjh-printer-agent
pnpm test
pnpm typecheck

cd ../mjh-printer-client
pnpm typecheck
```

Manual (with a real manifest URL configured):

```bash
curl http://127.0.0.1:17890/local/update/check
curl http://127.0.0.1:17890/local/update/status
curl -X POST http://127.0.0.1:17890/local/update/download
curl -X POST http://127.0.0.1:17890/local/update/apply
```

## Security notes

- No GitHub tokens on restaurant PCs
- No `git pull`
- Local API remains `127.0.0.1` only
- Tokens / Authorization stay redacted in Agent logs
