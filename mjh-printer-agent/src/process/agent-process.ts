import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { resolveRuntimePaths } from "../paths.js";

export const AGENT_PROCESS_ENV = "MJH_PRINTER_AGENT_PROCESS";
export const AGENT_PROCESS_FLAG = "--agent-process";
export const AGENT_EXE_BASENAME = "MJH-Printer-Agent.exe";

/** Default install path: `%ProgramW6432%\MJH Printer Agent\MJH-Printer-Agent.exe` */
export function resolveInstalledAgentExePath(env: NodeJS.ProcessEnv = process.env): string {
  const root = (env.ProgramW6432?.trim() || env.ProgramFiles?.trim() || "C:\\Program Files").replace(
    /[\\/]+$/,
    "",
  );
  return join(root, "MJH Printer Agent", AGENT_EXE_BASENAME);
}

export function normalizeExecutablePath(p: string): string {
  return p.trim().replace(/\//g, "\\").toLowerCase();
}

/**
 * True when `exePath` is the MJH Printer Agent binary
 * (installed Program Files path, or the same EXE as the current process).
 */
export function isMjhAgentExecutablePath(
  exePath: string | null | undefined,
  options?: { currentExePath?: string; env?: NodeJS.ProcessEnv },
): boolean {
  if (!exePath?.trim()) return false;
  const normalized = normalizeExecutablePath(exePath);
  const basenameOk =
    normalized.endsWith(`\\${AGENT_EXE_BASENAME.toLowerCase()}`) ||
    normalized === AGENT_EXE_BASENAME.toLowerCase();
  if (!basenameOk) return false;

  const expected = normalizeExecutablePath(resolveInstalledAgentExePath(options?.env));
  if (normalized === expected) return true;

  const current = options?.currentExePath?.trim();
  if (current) {
    const currentNorm = normalizeExecutablePath(current);
    if (
      normalized === currentNorm &&
      currentNorm.endsWith(`\\${AGENT_EXE_BASENAME.toLowerCase()}`)
    ) {
      return true;
    }
  }
  return false;
}

/** Resolve the absolute executable path for a live PID (Windows WMI / Linux /proc). */
export function getProcessExecutablePath(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;

  if (process.platform === "win32") {
    try {
      const out = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ExecutablePath`,
        ],
        { encoding: "utf8", windowsHide: true, timeout: 8_000 },
      );
      const path = out.trim().replace(/^"|"$/g, "");
      return path.length > 0 ? path : null;
    } catch {
      return null;
    }
  }

  try {
    return realpathSync(`/proc/${pid}/exe`);
  } catch {
    return null;
  }
}

export type ProcessInfo = {
  pid: number;
  name: string;
  commandLine: string;
  isMjhAgent: boolean;
};

/** Mark current process as the production MJH agent (for stop/diagnose). */
export function markCurrentAsAgentProcess(): void {
  process.env[AGENT_PROCESS_ENV] = "true";
  try {
    process.title = "MJH-Printer-Agent";
  } catch {
    // ignore
  }
}

export function classifyProcess(pid: number, name: string, commandLine: string): ProcessInfo {
  const lowerName = name.toLowerCase();
  const lowerCmd = commandLine.toLowerCase();
  const isMjhBinary =
    lowerName.includes("mjh-printer-agent") || lowerCmd.includes("mjh-printer-agent");

  // Explicit non-worker CLI — never treat as the long-running agent.
  const isCliOneShot =
    /\bagent:stop\b/.test(lowerCmd) ||
    /\bagent:status\b/.test(lowerCmd) ||
    /\bagent:diagnose\b/.test(lowerCmd) ||
    /\bdoctor\b/.test(lowerCmd) ||
    /\bversion\b/.test(lowerCmd) ||
    /\bconfig:/.test(lowerCmd) ||
    /\bprinter:test\b/.test(lowerCmd) ||
    /\blogs:path\b/.test(lowerCmd);

  const hasAgentStart =
    lowerCmd.includes("agent:start") || lowerCmd.includes(AGENT_PROCESS_FLAG);

  // Default production entry: EXE with no args resolves to agent:start.
  const bareExe =
    isMjhBinary &&
    !isCliOneShot &&
    /mjh-printer-agent\.exe"?\s*$/i.test(commandLine.trim());

  const isMjhAgent = isMjhBinary && !isCliOneShot && (hasAgentStart || bareExe);

  return { pid, name, commandLine, isMjhAgent };
}

/** List node.exe / MJH-Printer-Agent.exe processes with classification (Windows). */
export function listRelevantProcesses(): ProcessInfo[] {
  if (process.platform !== "win32") {
    return [];
  }

  const results: ProcessInfo[] = [];

  try {
    const out = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(node|MJH-Printer-Agent)' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 15000, maxBuffer: 5 * 1024 * 1024 },
    );
    const trimmed = out.trim();
    if (trimmed) {
      const parsed = JSON.parse(trimmed) as
        | { ProcessId: number; Name: string; CommandLine?: string }
        | Array<{ ProcessId: number; Name: string; CommandLine?: string }>;
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      for (const row of rows) {
        if (!row?.ProcessId) continue;
        results.push(
          classifyProcess(row.ProcessId, row.Name || "", row.CommandLine || ""),
        );
      }
    }
  } catch {
    // ignore — empty list
  }

  return results;
}

export function findRunningAgentPids(): number[] {
  const fromProcs = listRelevantProcesses()
    .filter((p) => p.isMjhAgent)
    .map((p) => p.pid);

  // agent.lock: only trust PID when the live process EXE is MJH-Printer-Agent.exe
  // (avoids Windows PID reuse → NVIDIA / other processes).
  const lockPath = resolveRuntimePaths().lockPath;
  if (existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
      if (
        typeof lock.pid === "number" &&
        isPidAlive(lock.pid) &&
        !fromProcs.includes(lock.pid) &&
        isMjhAgentExecutablePath(getProcessExecutablePath(lock.pid), {
          currentExePath: process.execPath,
        })
      ) {
        fromProcs.push(lock.pid);
      }
    } catch {
      // ignore
    }
  }

  // Fallback: image name (scheduled task / SYSTEM) when WMI classification misses.
  if (process.platform === "win32" && fromProcs.length === 0) {
    try {
      const out = execFileSync(
        "tasklist",
        ["/FI", "IMAGENAME eq MJH-Printer-Agent.exe", "/FO", "CSV", "/NH"],
        { encoding: "utf8", windowsHide: true },
      );
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/"MJH-Printer-Agent\.exe","(\d+)"/i);
        if (!m) continue;
        const pid = Number(m[1]);
        if (pid && pid !== process.pid && isPidAlive(pid) && !fromProcs.includes(pid)) {
          fromProcs.push(pid);
        }
      }
    } catch {
      // ignore
    }
  }

  return [...new Set(fromProcs)];
}

export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    return code === "EPERM";
  }
}

export function isMjhAgentPid(pid: number): boolean {
  if (!isPidAlive(pid)) return false;
  if (process.platform !== "win32") {
    return true;
  }
  const exe = getProcessExecutablePath(pid);
  if (isMjhAgentExecutablePath(exe, { currentExePath: process.execPath })) {
    return true;
  }
  const procs = listRelevantProcesses();
  const hit = procs.find((p) => p.pid === pid);
  if (hit) return hit.isMjhAgent;
  // Without a matching EXE path / command line, do not assume the PID is our agent.
  return false;
}

export type StopAgentResult = {
  pids: number[];
  stopped: number[];
  forced: number[];
  lines: string[];
};

/**
 * Graceful then force stop of MJH agent processes (never kills unrelated node.exe).
 */
export async function stopAgentProcesses(options?: {
  graceMs?: number;
  excludePid?: number;
}): Promise<StopAgentResult> {
  const graceMs = options?.graceMs ?? 5000;
  const excludePid = options?.excludePid ?? process.pid;
  const lines: string[] = [];
  const pids = findRunningAgentPids().filter((p) => p !== excludePid);
  const stopped: number[] = [];
  const forced: number[] = [];

  if (pids.length === 0) {
    lines.push("No MJH agent process found");
    return { pids, stopped, forced, lines };
  }

  lines.push(`Found agent PID(s): ${pids.join(", ")}`);

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      lines.push(`Sent SIGTERM to ${pid}`);
    } catch {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/PID", String(pid), "/T"], {
            windowsHide: true,
            stdio: "ignore",
          });
          lines.push(`taskkill /PID ${pid}`);
        }
      } catch {
        lines.push(`Could not signal ${pid}`);
      }
    }
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    const alive = pids.filter((p) => isPidAlive(p));
    if (alive.length === 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  for (const pid of pids) {
    if (!isPidAlive(pid)) {
      stopped.push(pid);
      continue;
    }
    try {
      if (process.platform === "win32") {
        // Only kill this PID tree — never image-name kill of node.exe
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } else {
        process.kill(pid, "SIGKILL");
      }
      forced.push(pid);
      lines.push(`Forced kill ${pid}`);
    } catch {
      lines.push(`Failed to force-kill ${pid}`);
    }
  }

  return { pids, stopped, forced, lines };
}
