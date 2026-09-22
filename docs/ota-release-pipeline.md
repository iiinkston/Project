# MJH Printer — OTA CI/CD Release Pipeline

## Release process

Developers only need a version tag. Do **not** rely on ordinary `main` commits to publish.

```bash
# 1. Bump versions in package.json as needed (independent):
#    mjh-printer-client/package.json  → Client semver (e.g. 1.0.8)
#    mjh-printer-agent/package.json   → Agent semver (e.g. 2.4.8)
#    Git tag does NOT have to equal Agent version.

# 2. Commit, then tag + push:
git tag v1.0.8
git push origin v1.0.8
```

GitHub Actions workflow **`OTA Release`** (`.github/workflows/ota-release.yml`) then:

1. Reads Client / Agent versions via `scripts/get-version.ps1`
2. Builds Agent (`pnpm test` → `typecheck` → `build:exe`)
3. Builds Client (`pnpm dist:setup` → `dist/client-build/MJH Printer Setup.exe`)
4. Stages assets under `release/`
5. Computes SHA256 with PowerShell `Get-FileHash`
6. Writes nested `release/release-metadata.json`
7. Creates a GitHub Release (`softprops/action-gh-release`) and uploads three assets

### Release assets

| Asset | Source |
|-------|--------|
| `MJH-Printer-Setup.exe` | Client NSIS Setup (space-free name for stable URLs) |
| `MJH-Printer-Agent-v{agentVersion}.zip` | Agent `package.json` version |
| `release-metadata.json` | Nested OTA manifest + SHA256 |

### `release-metadata.json` shape

Matches Cloud / Agent contract (same as `GET /v1/printer/update/latest`):

```json
{
  "client": {
    "version": "1.0.8",
    "url": "https://github.com/<owner>/<repo>/releases/download/v1.0.8/MJH-Printer-Setup.exe",
    "sha256": "<64 hex>"
  },
  "agent": {
    "version": "2.4.8",
    "url": "https://github.com/<owner>/<repo>/releases/download/v1.0.8/MJH-Printer-Agent-v2.4.8.zip",
    "sha256": "<64 hex>"
  }
}
```

URLs are built from `github.repository` + `github.ref_name` — never hardcoded secrets or manual SHA pasting.

---

## OTA flow

```text
git tag vX.Y.Z
        │
        ▼
GitHub Actions (windows-latest)
        │
        ├─ build Client + Agent
        ├─ SHA256(final assets)
        └─ GitHub Release
                │
                ├─ MJH-Printer-Setup.exe
                ├─ MJH-Printer-Agent-v{agent}.zip
                └─ release-metadata.json
                        │
                        ▼
              REMOTE_MANIFEST_URL  (ops points Cloud here)
                        │
                        ▼
              Cloud GET /v1/printer/update/latest
                        │
                        ▼
              Client / Agent OTA check → download → SHA verify → apply
```

Cloud API response schema is **unchanged** (`{ client:{}, agent:{} }`).  
After each release, set or refresh `REMOTE_MANIFEST_URL` to the Release asset URL for `release-metadata.json` (or a CDN copy of that file). ENV fallback (`CLIENT_*` / `AGENT_*`) remains available.

---

## Helper: `scripts/get-version.ps1`

```powershell
pwsh -File scripts/get-version.ps1
# → {"clientVersion":"1.0.8","agentVersion":"2.4.8"}
```

Avoids hardcoding versions in the workflow.

### Pre-release gates

```powershell
# Fails if package.json / electron-builder overrides drift, or tag contains "test"
powershell -File scripts/validate-release-versions.ps1 -Tag v1.0.8

# After staging assets (CI does this automatically):
powershell -File scripts/validate-release-metadata.ps1 `
  -MetadataPath release\release-metadata.json `
  -ClientSetupPath release\MJH-Printer-Setup.exe `
  -AgentZipPath release\MJH-Printer-Agent-v2.4.8.zip `
  -ExpectedClientVersion 1.0.8 -ExpectedAgentVersion 2.4.8
```

Client `build.buildVersion` / `extraMetadata.version` must not hardcode a different number — leave unset so electron-builder uses `package.json` version.

---

## Cloud: `REMOTE_MANIFEST_URL`

After each successful Release, set production:

```env
REMOTE_MANIFEST_URL=https://github.com/iiinkston/Project/releases/download/v1.0.8/release-metadata.json
```

Do **not** manually rewrite `CLIENT_UPDATE_*` / `AGENT_UPDATE_*` for every cutover. Keep ENV only as cold fallback (see `docs/ota-manifest-provider-design.md`).

Full GA steps: `docs/ota-ga-release-checklist.md`.

---

## Local dry-run (before tagging)

```powershell
# Agent
cd mjh-printer-agent
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build:exe
# expect: release/MJH-Printer-Agent-v{version}.zip

# Client
cd ../mjh-printer-client
pnpm install --frozen-lockfile
pnpm dist:setup
# expect: ../dist/client-build/MJH Printer Setup.exe
```

Optional metadata preview:

```powershell
$ver = pwsh -File scripts/get-version.ps1 | ConvertFrom-Json
$setup = "dist\client-build\MJH Printer Setup.exe"
$zip = "mjh-printer-agent\release\MJH-Printer-Agent-v$($ver.agentVersion).zip"
(Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
```

---

## Test tag

```bash
git tag v-test-release
git push origin v-test-release
```

Verify in GitHub Actions / Releases:

- [ ] Workflow **OTA Release** succeeds
- [ ] Release exists for `v-test-release`
- [ ] Three assets uploaded
- [ ] Local SHA256 matches Release assets
- [ ] `release-metadata.json` parses as nested `{ client, agent }`

Delete the test release/tag when done if it should not stay public.

---

## Risks / notes

1. **Client version source of truth** — only `mjh-printer-client/package.json` `version`. Do not reintroduce drifting `buildVersion` / `extraMetadata.version`.
2. **Agent version ≠ git tag** — zip name uses Agent `package.json` only; tag is the Release channel label.
3. **Test tags** — CI refuses tags whose name contains `test` (e.g. `v-test-release`).
4. **Code signing** — CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; unsigned Setup may trigger SmartScreen.
5. **REMOTE_MANIFEST_URL** — ops step after each Release; pipeline does not mutate production Cloud env.
6. **Anti-downgrade** — Client/Agent ignore `remote <= current` (see checklist).
