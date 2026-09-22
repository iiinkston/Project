# Fresh Install Report — MJH Printer Desktop RC

| Field | Value |
|-------|-------|
| Date (UTC) | 2026-09-22 |
| OS | Windows 11 x64 |
| Client | **1.0.4** |
| Agent | **2.4.4** |
| Setup | `D:\Project\dist\client-build\MJH Printer Setup.exe` (93.37 MB) |
| Setup (no-space copy) | `D:\Project\dist\client-build\MJH-Printer-Setup.exe` |
| Report dir | `D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\` |

---

## Artifact versions

| Component | Path | Version check | Result |
|-----------|------|---------------|--------|
| Agent EXE (staged/built) | `mjh-printer-agent\release\MJH-Printer-Agent.exe` | `version` → 2.4.4 | **PASS** |
| Agent installed | `C:\Program Files\MJH Printer Agent\MJH-Printer-Agent.exe` | `version` → 2.4.4 / build `2026-09-22T03:50:08Z` | **PASS** |
| Client installed | `C:\Program Files\MJH Printer\MJH Printer Client.exe` | `client.log` → `version=1.0.4` | **PASS** |
| NSIS Setup | `dist\client-build\MJH Printer Setup.exe` | built 2026-09-22 11:51 | **PASS** |

---

## Test steps & results

### 1. Build

| Step | Result |
|------|--------|
| `pnpm build:exe` (Agent 2.4.4) | **PASS** |
| `pnpm dist:setup` (Client 1.0.4 + staged Agent) | **PASS** |

### 2. Cleanup / Fresh install

| Step | Result | Notes |
|------|--------|-------|
| Backup ProgramData | **PASS** | `programdata-backup\` |
| Silent uninstall previous Client/Agent | **PASS** | Program Files cleared |
| Silent install `MJH-Printer-Setup.exe /S` | **PASS** | exit 0 |
| Agent path `C:\Program Files\MJH Printer Agent\` | **PASS** | EXE present |
| Client path `C:\Program Files\MJH Printer\` | **PASS** | EXE present |
| Task Scheduler `MJH Printer Agent` | **PASS** | exists, State=Running (query as admin) |
| Local API `127.0.0.1:17890/local/health` | **PASS** | `{"ok":true}` |

### 3. Phase A — Keep ProgramData config

| Check | Result |
|-------|--------|
| Config retained | **PASS** |
| `bound=true` | **PASS** |
| `cloud.online=true` | **PASS** |
| `printer.online=true` | **PASS** |
| `lifecycle=RUNNING` | **PASS** |
| Agent version in status | **PASS** (`2.4.4`) |

Evidence: `status-after-install.json`

### 4. Client UI / Tray

| Check | Result |
|-------|--------|
| Client opens | **PASS** |
| Main window title present | **PASS** (满江红打印助手) |
| Tray / background process | **PASS** (process stays up) |
| Stability log `hwAccel=off singleInstance=yes` | **PASS** |
| Renderer crash recovery log observed | **PASS** (`recoveryCount=1` during Agent restart) |

Screenshots:

- `01-client-after-install.png`
- `02-client-dashboard-after-bind.png`
- `03-tray-area.png`

### 5. Stale `agent.lock` recovery

| Step | Result |
|------|--------|
| Write lock with dead PID `99999991` | **PASS** |
| Restart Agent | **PASS** |
| Auto-clear stale lock | **PASS** |
| New lock `pid` ≠ 99999991, `exePath` = installed Agent | **PASS** |
| Health OK after recovery | **PASS** |

Evidence: `fresh-install-run.log` (`STALE LOCK result=PASS`), `status-after-stale-lock.json`

### 6. Phase B — Clear ProgramData + bind `MJH-001`

| Step | Result |
|------|--------|
| Wipe ProgramData + write unbound config | **PASS** |
| Agent starts `bound=false` / `UNBOUND` | **PASS** |
| `POST /local/bind` code `MJH-001` | **PASS** |
| Response `success=true`, store `Man Jiang Hong` | **PASS** |
| After bind: `bound=true` | **PASS** |
| `cloud.online=true` | **PASS** |
| `printer.online=true` | **PASS** |
| `lifecycle=RUNNING` | **PASS** |

Evidence: `bind-MJH-001.json`, `status-after-bind.json`, `status-cleared-unbound.json`

---

## Final status snapshot (after bind)

```json
{
  "version": "2.4.4",
  "bound": true,
  "lifecycle": "RUNNING",
  "storeName": "Man Jiang Hong",
  "cloud": { "online": true },
  "printer": { "model": "XP-N160II", "ip": "192.168.0.110", "port": 9100, "online": true }
}
```

---

## Screenshot paths

| # | File |
|---|------|
| 1 | `D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\01-client-after-install.png` |
| 2 | `D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\02-client-dashboard-after-bind.png` |
| 3 | `D:\Project\docs\rc-reports\2026-09-22-1.0.4-2.4.4\03-tray-area.png` |

---

## Overall

| Area | Verdict |
|------|---------|
| Agent 2.4.4 install + Task + API | **PASS** |
| Client 1.0.4 install + UI + Tray | **PASS** |
| Keep-config restore | **PASS** |
| Clear-config + MJH-001 bind | **PASS** |
| Stale lock auto-recovery | **PASS** |
| **RC Fresh Install** | **PASS** |

---

## Notes

1. NSIS silent install with paths containing spaces must be quoted; RC automation uses `MJH-Printer-Setup.exe` copy.
2. Unbound `printer.json` requires non-empty `store.id` (schema `min(1)`); clear-config used `"unbound"` then bind replaced it.
3. FileVersionInfo of Client EXE shows Electron `34.5.8`; app version **1.0.4** is confirmed via `client.log` / `app.getVersion()`.
