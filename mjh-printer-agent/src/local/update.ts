import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { getExecutableDir, resolveProgramDataRoot } from "../paths.js";
import { AGENT_VERSION } from "../version.js";
import { logger } from "../logger.js";
import type { LocalUpdateCheckResponse, LocalOkResponse, LocalErrorResponse } from "./types.js";

const EXE_NAME = "MJH-Printer-Agent.exe";
const UPDATE_SCRIPT = "update-agent.ps1";

export type UpdateManifest = {
  latestVersion?: string;
  notes?: string;
  /** Absolute or relative to updates dir */
  exePath?: string;
};

function programFiles64Root(): string {
  const w6432 = process.env.ProgramW6432?.trim();
  const pf = process.env.ProgramFiles?.trim();
  return w6432 || pf || "C:\\Program Files";
}

function programFilesAgentDir(): string {
  return join(programFiles64Root(), "MJH Printer Agent");
}

function programFilesClientUpdaterDir(): string {
  return join(programFiles64Root(), "MJH Printer", "updater");
}

export function resolveUpdatesDir(): string {
  return join(resolveProgramDataRoot(), "updates");
}

export function resolveUpdateScriptPath(): string | null {
  const candidates = [
    join(getExecutableDir(), UPDATE_SCRIPT),
    join(programFilesAgentDir(), UPDATE_SCRIPT),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export function resolveStagedUpdateExe(): string | null {
  const updatesDir = resolveUpdatesDir();
  const manifestPath = join(updatesDir, "manifest.json");
  if (existsSync(manifestPath)) {
    try {
      const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as UpdateManifest;
      if (raw.exePath?.trim()) {
        const p = raw.exePath.includes(":") || raw.exePath.startsWith("\\\\")
          ? raw.exePath
          : join(updatesDir, raw.exePath);
        if (existsSync(p)) return p;
      }
    } catch {
      // fall through
    }
  }

  const candidates = [
    join(updatesDir, EXE_NAME),
    join(programFilesClientUpdaterDir(), EXE_NAME),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function readManifest(): UpdateManifest | null {
  const path = join(resolveUpdatesDir(), "manifest.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as UpdateManifest;
  } catch {
    return null;
  }
}

/** Simple semver-ish compare: a > b → 1, a < b → -1, else 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, "").split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.replace(/^v/i, "").split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function versionFromBuildTxt(dir: string): string | null {
  const p = join(dir, "BUILD.txt");
  if (!existsSync(p)) return null;
  try {
    const text = readFileSync(p, "utf8");
    const m = text.match(/version\s*=\s*([^\r\n]+)/i);
    return m?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

export function handleUpdateCheck(): LocalUpdateCheckResponse {
  const currentVersion = AGENT_VERSION;
  const manifest = readManifest();
  const staged = resolveStagedUpdateExe();

  let latestVersion = currentVersion;
  let notes: string | null = manifest?.notes?.trim() || null;

  if (manifest?.latestVersion?.trim()) {
    latestVersion = manifest.latestVersion.trim();
  } else if (staged) {
    const fromTxt =
      versionFromBuildTxt(join(staged, "..")) ||
      versionFromBuildTxt(resolveUpdatesDir()) ||
      versionFromBuildTxt(programFilesClientUpdaterDir());
    if (fromTxt) latestVersion = fromTxt;
  }

  const updateAvailable =
    Boolean(staged) && compareVersions(latestVersion, currentVersion) > 0;

  if (!updateAvailable && !staged) {
    latestVersion = currentVersion;
  }

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    notes,
  };
}

/**
 * Kick off existing update-agent.ps1 (detached). Does not copy EXE itself.
 */
export function handleUpdateApply(): LocalOkResponse | LocalErrorResponse {
  const check = handleUpdateCheck();
  if (!check.updateAvailable) {
    return { ok: false, error: "当前已是最新版本，或未找到待更新安装包" };
  }

  const source = resolveStagedUpdateExe();
  if (!source) {
    return { ok: false, error: "未找到更新包 EXE（请将新版放到 ProgramData\\…\\updates）" };
  }

  const script = resolveUpdateScriptPath();
  if (!script) {
    return {
      ok: false,
      error: "未找到 update-agent.ps1（请确认 Agent 安装目录含更新脚本）",
    };
  }

  logger.info(`[LocalAPI] update start source=${source} script=${script}`, "UPDATE");

  // Detached: update script stops this process and replaces EXE.
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
      "-Source",
      source,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();

  return {
    ok: true,
    message: "已启动更新，Agent 将重启。请稍候刷新状态。",
  };
}
