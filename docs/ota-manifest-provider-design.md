# OTA Manifest Provider Design

**Date:** 2026-09-22  
**Scope:** Cloud API `@mjh/api` — `GET /api/v1/printer/update/latest`  
**Status:** Implemented in `apps/api/src/modules/printer/`

---

## Problem

Production OTA metadata was assembled only from process env:

```text
CLIENT_VERSION / CLIENT_UPDATE_URL / CLIENT_UPDATE_SHA256
AGENT_VERSION  / AGENT_UPDATE_URL  / AGENT_UPDATE_SHA256
```

Every Client/Agent release required a production env edit + API restart. That is slow, error-prone, and blocks GA cutovers (see `docs/ota-ga-production-validation.md`).

---

## Goal

Move release metadata to an **external nested manifest**, while keeping the public API contract unchanged.

| Concern | Decision |
|---------|----------|
| Public route | Unchanged: `GET /api/v1/printer/update/latest` (Nest `/v1/printer/update/latest`) |
| Response JSON | Nested only: `{ client:{version,url,sha256}, agent:{…} }` |
| Auth | Public (no Bearer) — same as today |
| Cloud API code for pairing / PrintJob | Untouched |

---

## Architecture

```text
                    ┌─────────────────────────────┐
  Agent / Client ──►│ GET /v1/printer/update/latest│
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │     OtaManifestProvider      │
                    │  priority + TTL cache        │
                    └──────┬───────────────┬───────┘
           REMOTE_MANIFEST_URL          ENV fallback
                           │               │
                           ▼               ▼
              https://…/manifest.json   CLIENT_* / AGENT_*
```

### Priority

1. **`REMOTE_MANIFEST_URL`** (when set) — fetch nested JSON  
2. **ENV** — `CLIENT_*` / `AGENT_*` (legacy `PRINTER_*` aliases accepted)  
3. **Last valid cache** — used when remote fails after a prior success (even if TTL expired)

Within TTL (default **5 minutes**), a successful resolve is served from memory as `source: "cache"` without re-fetching.

### Failure matrix

| Remote URL | Remote fetch | Cache | ENV | Result |
|------------|--------------|-------|-----|--------|
| unset | — | — | valid | ENV |
| set | OK | update | — | remote |
| set | within TTL | hit | — | cache |
| set | fail | prior valid | — | cache (stale OK) |
| set | fail | empty | valid | ENV |
| set | fail | empty | invalid | **503** |

---

## Manifest format

Canonical remote file and API response:

```json
{
  "client": {
    "version": "1.0.7",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.7-ga-test/MJH-Printer-Setup.exe",
    "sha256": "984051e7512f2332cf2f2dae67a9d547366817a9541bbfd502ebcdea89c62ef1"
  },
  "agent": {
    "version": "2.4.8",
    "url": "https://github.com/iiinkston/Project/releases/download/v1.0.7-ga-test/MJH-Printer-Agent-v2.4.8.zip",
    "sha256": "e3c18b15f81590a26eb09835dd18f49bb2d887c34d3fded830c05f2cfed44208"
  }
}
```

Validation rules:

- `version` non-empty string (semver recommended; do **not** put `*-test` in the version field if compare is numeric)
- `url` absolute `http://` or `https://`
- `sha256` exactly 64 lowercase hex (input is normalized to lowercase)

Flat payloads (`clientVersion` / `agentVersion` at top level) are **rejected** at the Cloud boundary so Agent/Client normalizers keep a single nested contract from this endpoint.

---

## Configuration

### Recommended (remote metadata)

```env
REMOTE_MANIFEST_URL=https://cdn.example.com/mjh/ota/stable.json
```

Host the JSON on object storage / GitHub raw / any HTTPS URL ops can update without restarting the API. After TTL elapses, Cloud picks up the new file automatically.

### Fallback (local env — unchanged names)

```env
CLIENT_VERSION=1.0.5
CLIENT_UPDATE_URL=https://…
CLIENT_UPDATE_SHA256=…
AGENT_VERSION=2.4.5
AGENT_UPDATE_URL=https://…
AGENT_UPDATE_SHA256=…
```

Aliases still accepted for older snippets: `PRINTER_CLIENT_*` / `PRINTER_AGENT_*`.

Ops tip: keep ENV populated as bootstrap/fallback even when `REMOTE_MANIFEST_URL` is set.

---

## Code map

| File | Role |
|------|------|
| `ota-manifest.types.ts` | `OtaReleaseManifest` types |
| `ota-manifest.provider.ts` | Parse, ENV read, remote fetch, TTL cache |
| `ota-manifest.provider.spec.ts` | Jest unit tests |
| `printer-update.controller.ts` | `GET printer/update/latest` |
| `printer.module.ts` | Registers controller + provider |

`PrinterUpdateController.latest()` returns **only** the nested manifest body (no `source` / `cachedAt` leakage). Resolution metadata stays inside the provider for logs/tests.

---

## Cache behaviour (detail)

- In-process memory only (per API instance). Multi-replica: each process has its own TTL window (acceptable for 5 min OTA metadata).
- Successful **remote** resolve updates cache.
- Successful **ENV** resolve updates cache when remote URL is unset, or when remote failed and cache was empty.
- When remote URL is set and a prior remote cache exists, ENV success during outage does **not** overwrite that remote cache (so the last known good remote file remains the outage fallback).

Default TTL: `OTA_MANIFEST_CACHE_TTL_MS = 5 * 60 * 1000`.  
Remote fetch timeout: 8s (AbortController).

---

## Tests

`ota-manifest.provider.spec.ts` covers:

1. Nested parse + sha256 normalize  
2. Reject flat JSON  
3. ENV mapping + `PRINTER_*` aliases  
4. Remote preferred over ENV  
5. TTL cache hit (no re-fetch)  
6. Re-fetch after TTL  
7. Remote fail → previous valid cache  
8. Remote fail + empty cache → ENV  
9. Total failure → `ServiceUnavailableException` (503)

Run:

```bash
cd mjh-qr-ordering-demo/apps/api
pnpm test -- ota-manifest.provider.spec.ts
```

---

## Rollout

1. Deploy API with provider (ENV-only behaviour = current production).  
2. Publish `stable.json` (or channel-specific URL) with nested manifest.  
3. Set `REMOTE_MANIFEST_URL` on one instance; verify `GET …/update/latest`.  
4. Subsequent releases: **edit the remote JSON only** — no Cloud env churn.  
5. Keep ENV as cold fallback until remote hosting is trusted.

---

## Non-goals

- Changing Agent/Client Local API or apply/elevation paths  
- Auto-writing production Cloud env from CI  
- Serving flat dual-shape from this endpoint (Agent already normalizes nested)  
- Persistent Redis/DB cache (in-memory TTL is enough for 5 min)
