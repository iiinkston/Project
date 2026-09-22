import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveProgramDataRoot } from "../paths.js";
import { logger } from "../logger.js";

export const OTA_UPDATE_TASK_NAME = "MJH Printer Agent Update";
export const ELEVATION_REQUIRED = "ELEVATION_REQUIRED";

export type ApplyRequest = {
  source: string;
  script: string;
  requestedAt: string;
};

export type LaunchApplyResult =
  | { ok: true; mode: "direct" }
  | { ok: true; mode: "scheduled-task"; elevationRequired: true }
  | { ok: true; mode: "uac-runas"; elevationRequired: true }
  | { ok: false; error: string };

/** True when the current process token is elevated (Administrator / SYSTEM). */
export function isProcessElevated(): boolean {
  if (process.platform !== "win32") {
    return true;
  }
  try {
    execFileSync("net", ["session"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

export function resolveApplyRequestPath(
  programDataRoot: string = resolveProgramDataRoot(),
): string {
  return join(programDataRoot, "updates", "apply-request.json");
}

export function writeApplyRequest(
  request: ApplyRequest,
  programDataRoot: string = resolveProgramDataRoot(),
): string {
  const path = resolveApplyRequestPath(programDataRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return path;
}

function psSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Try to start the pre-registered elevated Scheduled Task (SYSTEM / Highest).
 * Non-admin callers can run this when install granted Users execute rights.
 */
export function tryStartUpdateScheduledTask(
  taskName: string = OTA_UPDATE_TASK_NAME,
): boolean {
  if (process.platform !== "win32") return false;
  try {
    execFileSync(
      "schtasks.exe",
      ["/Run", "/TN", taskName],
      { stdio: "ignore", windowsHide: true, timeout: 15_000 },
    );
    return true;
  } catch {
    return false;
  }
}

export function startUpdateViaUacRunAs(scriptPath: string, sourcePath: string): void {
  const elevateCmd =
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden ` +
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psSingleQuote(scriptPath)},'-Source',${psSingleQuote(sourcePath)})`;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", elevateCmd],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
}

export function startUpdateDirect(scriptPath: string, sourcePath: string): void {
  const child = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-Source",
      sourcePath,
    ],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
}

/**
 * Permission chain only — download/sha/stage remain unchanged.
 *
 * - Elevated process → run update-agent.ps1 directly → ok (no ELEVATION_REQUIRED)
 * - Non-elevated → prefer Scheduled Task helper; else UAC RunAs
 *   → never report plain success; caller maps to ELEVATION_REQUIRED
 */
export function launchElevatedUpdateApply(options: {
  scriptPath: string;
  sourcePath: string;
  elevated?: boolean;
  programDataRoot?: string;
  tryScheduledTask?: () => boolean;
  startDirect?: (script: string, source: string) => void;
  startUac?: (script: string, source: string) => void;
}): LaunchApplyResult {
  const elevated = options.elevated ?? isProcessElevated();
  const programDataRoot = options.programDataRoot ?? resolveProgramDataRoot();
  const tryTask = options.tryScheduledTask ?? tryStartUpdateScheduledTask;
  const startDirect = options.startDirect ?? startUpdateDirect;
  const startUac = options.startUac ?? startUpdateViaUacRunAs;

  if (!existsSync(options.scriptPath)) {
    return { ok: false, error: "未找到 update-agent.ps1（请确认 Agent 安装目录含更新脚本）" };
  }
  if (!existsSync(options.sourcePath)) {
    return { ok: false, error: "未找到更新包 EXE（请将新版放到 ProgramData\\…\\updates）" };
  }

  writeApplyRequest(
    {
      source: options.sourcePath,
      script: options.scriptPath,
      requestedAt: new Date().toISOString(),
    },
    programDataRoot,
  );

  if (elevated) {
    logger.info("OTA APPLY launch mode=direct (elevated)", "OTA");
    startDirect(options.scriptPath, options.sourcePath);
    return { ok: true, mode: "direct" };
  }

  if (tryTask()) {
    logger.info(`OTA APPLY launch mode=scheduled-task task=${OTA_UPDATE_TASK_NAME}`, "OTA");
    return { ok: true, mode: "scheduled-task", elevationRequired: true };
  }

  logger.info("OTA APPLY launch mode=uac-runas (scheduled task unavailable)", "OTA");
  try {
    startUac(options.scriptPath, options.sourcePath);
    return { ok: true, mode: "uac-runas", elevationRequired: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `无法启动提权更新: ${message}` };
  }
}
