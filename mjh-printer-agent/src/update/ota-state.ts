import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUpdatesDir } from "../local/update.js";
import type { OtaPersistedState } from "./ota-types.js";

const EMPTY: OtaPersistedState = {
  lastCheckAt: null,
  lastError: null,
  remoteVersion: null,
  remoteNotes: null,
  remoteSha256: null,
  remoteUrl: null,
  mandatory: false,
  downloadedVersion: null,
  downloadedSha256: null,
  ready: false,
};

export function resolveOtaStatePath(): string {
  return join(resolveUpdatesDir(), "ota-state.json");
}

export function readOtaState(): OtaPersistedState {
  const path = resolveOtaStatePath();
  if (!existsSync(path)) return { ...EMPTY };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<OtaPersistedState>;
    return { ...EMPTY, ...raw };
  } catch {
    return { ...EMPTY };
  }
}

export function writeOtaState(patch: Partial<OtaPersistedState>): OtaPersistedState {
  const next = { ...readOtaState(), ...patch };
  const path = resolveOtaStatePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
