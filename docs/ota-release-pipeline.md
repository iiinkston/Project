# MJH Printer — OTA CI/CD Release Pipeline

## Release process

Developers only need a version tag. Do **not** rely on ordinary `main` commits to publish.

```bash
# 1. Bump package.json as needed (build identity; independent of OTA metadata client.version):
#    mjh-printer-client/package.json  → Client app / NSIS build version
#    mjh-printer-agent/package.json   → Agent semver (e.g. 2.4.8) → zip name + metadata agent.version
#    Git tag vX.Y.Z IS the OTA Client version in release-metadata.json (not package.json).

# 2. Commit, then tag + push (tag = OTA client.version):
git tag v1.0.9
git push origin v1.0.9
```

GitHub Actions workflow **`OTA Release`** (`.github/workflows/ota-release.yml`) then:

1. Parses `GITHUB_REF_NAME` (`v1.0.9` → `1.0.9`) via `scripts/parse-release-tag.ps1`
2. Runs package.json / electron-builder gates via `scripts/validate-release-versions.ps1` (separate from OTA client version)
3. Builds Agent (`pnpm test` → `typecheck` → `build:exe`)
4. Builds Client (`pnpm dist:setup` → `dist/client-build/MJH Printer Setup.exe`)
5. Stages assets under `release/`
6. Computes SHA256 with PowerShell `Get-FileHash`
7. Writes nested `release/release-metadata.json` with **client.version from git tag**
8. Validates tag semver == metadata `client.version` (fails workflow on mismatch)
9. Generates `release/RELEASE_NOTES.md` — **Client Setup from git tag** (not package.json); Agent from package.json
10. Validates Release Notes Client Setup == metadata `client.version`
11. Creates a GitHub Release (`softprops/action-gh-release`) with `body_path` + uploads three assets

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
    "version": "1.0.9",
    "url": "https://github.com/<owner>/<repo>/releases/download/v1.0.9/MJH-Printer-Setup.exe",
    "sha256": "<64 hex>"
  },
  "agent": {
    "version": "2.4.8",
    "url": "https://github.com/<owner>/<repo>/releases/download/v1.0.9/MJH-Printer-Agent-v2.4.8.zip",
    "sha256": "<64 hex>"
  }
}
```

| Field | Source |
|-------|--------|
| `client.version` | Git tag (`GITHUB_REF_NAME`: `v1.0.9` → `1.0.9`) — **not** `package.json` |
| `agent.version` | `mjh-printer-agent/package.json` |

URLs are built from `github.repository` + `github.ref_name` — never hardcoded secrets or manual SHA pasting.

---

## OTA flow

```text
git tag vX.Y.Z
        │
        ▼
GitHub Actions (windows-latest)
        │
        ├─ client.version = parse(GITHUB_REF_NAME)
        ├─ agent.version  = Agent package.json
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

## Helpers

### `scripts/parse-release-tag.ps1`

```powershell
pwsh -File scripts/parse-release-tag.ps1 -Tag v1.0.9
# → {"tag":"v1.0.9","clientVersion":"1.0.9"}
```

### `scripts/get-version.ps1` (package.json only)

```powershell
pwsh -File scripts/get-version.ps1
# → {"clientVersion":"…","agentVersion":"…"}  # from package.json — not used for OTA client.version
```

### Pre-release / metadata / notes gates

```powershell
# package.json semver + electron-builder drift; optional tag parse + TAG_PKG_DRIFT warn
powershell -File scripts/validate-release-versions.ps1 -Tag v1.0.10

# After staging assets (CI does this automatically):
# Fails if ReleaseTag semver != metadata client.version
powershell -File scripts/validate-release-metadata.ps1 `
  -MetadataPath release\release-metadata.json `
  -ClientSetupPath release\MJH-Printer-Setup.exe `
  -AgentZipPath release\MJH-Printer-Agent-v2.4.8.zip `
  -ExpectedClientVersion 1.0.10 -ExpectedAgentVersion 2.4.8 `
  -ReleaseTag v1.0.10

# Release notes Client Setup must match metadata (tag-sourced)
powershell -File scripts/generate-release-notes.ps1 `
  -Tag v1.0.10 -ClientVersion 1.0.10 -AgentVersion 2.4.8 `
  -Repository owner/repo -OutFile release\RELEASE_NOTES.md
powershell -File scripts/validate-release-notes.ps1 `
  -NotesPath release\RELEASE_NOTES.md `
  -MetadataPath release\release-metadata.json
```

Client `build.buildVersion` / `extraMetadata.version` must not hardcode a different number — leave unset so electron-builder uses `package.json` version (build identity remains separate from OTA metadata).

---

## Cloud: `REMOTE_MANIFEST_URL`

After each successful Release, set production:

```env
REMOTE_MANIFEST_URL=https://github.com/iiinkston/Project/releases/download/v1.0.9/release-metadata.json
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

Optional metadata preview (use tag for client.version):

```powershell
$tag = "v1.0.9"
$clientVer = (pwsh -File scripts/parse-release-tag.ps1 -Tag $tag | ConvertFrom-Json).clientVersion
$agentVer = (pwsh -File scripts/get-version.ps1 | ConvertFrom-Json).agentVersion
$setup = "dist\client-build\MJH Printer Setup.exe"
$zip = "mjh-printer-agent\release\MJH-Printer-Agent-v$agentVer.zip"
(Get-FileHash $setup -Algorithm SHA256).Hash.ToLowerInvariant()
(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
```

---

## Test tag

CI refuses tags whose name contains `test` (e.g. `v-test-release`). Use a real `vX.Y.Z` tag for pipeline verification.

---

## Risks / notes

1. **OTA Client version** — git tag (`vX.Y.Z` → `X.Y.Z`) is the source of truth for `release-metadata.json` `client.version`. Do **not** use Client `package.json` for OTA metadata.
2. **package.json** — still gated for semver + electron-builder overrides; may warn on tag/package drift but does not override metadata.
3. **Agent version ≠ git tag** — zip name uses Agent `package.json` only; tag labels the Release and Client OTA version.
4. **Tag ↔ metadata gate** — CI fails if tag semver ≠ metadata `client.version`.
5. **Release notes** — Client Setup row uses git tag; CI fails if notes ≠ metadata `client.version`.
6. **Code signing** — CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`; unsigned Setup may trigger SmartScreen.
7. **REMOTE_MANIFEST_URL** — ops step after each Release; pipeline does not mutate production Cloud env.
8. **Anti-downgrade** — Client/Agent ignore `remote <= current` (see checklist).
