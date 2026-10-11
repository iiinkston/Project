# Store Deployment — Malaysia (满江红)

Human-facing package for the restaurant owner:

**`MJH-Printer-Setup.exe`**

Owner does **not** need PowerShell, CMD, Node, Git, or manual Scheduled Tasks.

Physical printer validation is performed **on-site** (not on the development PC).

---

## Confirmed store network (example)

| Item | Value |
|------|--------|
| PC IPv4 | `192.168.1.117` (DHCP) |
| DNS / gateway | `192.168.1.1` |
| Expected LAN | `192.168.1.0/24` |
| Wi-Fi SSIDs | `manjianghong-2.4G@unifi`, `manjianghong-5G@unifi` |

**Important:** Setup and Client **do not hard-code** `192.168.1.0/24`.  
Discovery always derives the /24 from the **active Windows adapter**. If the PC later gets another DHCP address on the same LAN, Discover still works.

---

## 2.4 GHz / 5 GHz

Typical layout:

- Kitchen printer (XP-N160II): **2.4 GHz**
- Windows PC: **2.4 GHz or 5 GHz**

This works **only when** UniFi places both SSIDs on the **same LAN/VLAN** and **client/AP isolation is disabled**.

Software cannot bypass VLAN or client isolation.

If Discover finds nothing, verify reachability from the PC:

```powershell
Test-NetConnection <printer-ip> -Port 9100
```

Do **not** change router config from the MJH app.

---

## Owner install flow

1. Connect PC to `manjianghong-2.4G@unifi` **or** `manjianghong-5G@unifi`.
2. Confirm Windows has a `192.168.1.x` address (example: `192.168.1.117`).
3. Run **`MJH-Printer-Setup.exe`** → approve UAC.
4. Wait for Agent health + Client window (**满江红打印助手**).
5. If unbound: pair with **`MJH-001`**.
6. Open **打印机设置**.
7. Confirm UI shows detected subnet (example: `192.168.1.0/24`).
8. Click **扫描打印机** (Discover).
9. Select **XP-N160II** (IP must be `192.168.1.x`).
10. **测试打印**.
11. Place a **real QR order** (QR → Web → Cloud → PrintJob → Agent → printer).
12. Confirm kitchen/cashier tickets print.
13. **Restart Windows**.
14. Confirm Agent / Cloud / Printer online.
15. Place another test order.

---

## Acceptance checklist (fill on site)

| # | Check | Result |
|---|--------|--------|
| 1 | PC on UniFi SSID | |
| 2 | PC IPv4 `192.168.1.x` | |
| 3 | Setup installs without PowerShell | |
| 4 | Pair `MJH-001` (or already bound) | |
| 5 | Detected subnet shown | |
| 6 | Discover finds printer | |
| 7 | Selected IP is `192.168.1.x` | |
| 8 | TCP 9100 OK | |
| 9 | Local test print | |
| 10 | Real QR order prints | |
| 11 | After reboot: Agent + Cloud + Printer | |
| 12 | Second order prints | |

Status labels:

- **PASS** — verified on store PC with physical print
- **STATIC PASS / STORE TEST REQUIRED** — packaging/network logic OK; physical print not yet done
- **FAIL** — blocked

Do **not** mark physical printing **PASS** until steps 9–12 succeed at the restaurant.

---

## Upgrade / reinstall

- Re-running Setup upgrades Client + Agent.
- **`C:\ProgramData\MJH Printer Agent\config`** is preserved (token, store, printer IP).
- Default uninstall **keeps** ProgramData config (no forced re-pair).

---

## Support artifacts

| Path | Purpose |
|------|---------|
| `C:\ProgramData\MJH Printer Client\logs\installer-start.log` | Install health / launch |
| Agent logs under ProgramData | Runtime / Discover (`DISCOVERY_*`) |
| Cloud OTA | Client Setup + Agent zip (independent) |
