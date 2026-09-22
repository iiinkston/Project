import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  getProcessExecutablePath,
  isMjhAgentExecutablePath,
  isPidAlive,
  resolveInstalledAgentExePath,
} from "../process/agent-process.js";

export type AgentLockInfo = {
  pid: number;
  /** Absolute path of the agent EXE that owns this lock. */
  exePath: string;
  /** ISO timestamp when the lock was created. */
  createdAt: string;
  version: string;
};

/** Injectable probes — tests mock PID reuse / foreign owners without real OS processes. */
export type AgentLockDeps = {
  isPidAlive?: (pid: number) => boolean;
  getExecutablePath?: (pid: number) => string | null;
  currentPid?: () => number;
  currentExePath?: () => string;
  nowIso?: () => string;
};

export class AgentAlreadyRunningError extends Error {
  readonly existingPid: number;

  constructor(existingPid: number) {
    super(`Printer Agent already running (PID ${existingPid})`);
    this.name = "AgentAlreadyRunningError";
    this.existingPid = existingPid;
  }
}

export async function readAgentLock(filePath: string): Promise<AgentLockInfo | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentLockInfo> & { startedAt?: string };
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    const createdAt =
      typeof parsed.createdAt === "string" && parsed.createdAt.trim()
        ? parsed.createdAt.trim()
        : typeof parsed.startedAt === "string"
          ? parsed.startedAt
          : "";
    return {
      pid: parsed.pid,
      exePath: typeof parsed.exePath === "string" ? parsed.exePath.trim() : "",
      createdAt,
      version: typeof parsed.version === "string" ? parsed.version : "",
    };
  } catch {
    return null;
  }
}

/**
 * True when a live PID is the MJH Printer Agent EXE
 * (`…\MJH Printer Agent\MJH-Printer-Agent.exe`), not a reused PID.
 */
export function isLiveMjhAgentOwner(
  pid: number,
  deps: AgentLockDeps = {},
): boolean {
  const alive = deps.isPidAlive ?? isPidAlive;
  const getExe = deps.getExecutablePath ?? getProcessExecutablePath;
  const currentPid = deps.currentPid?.() ?? process.pid;
  const currentExe =
    deps.currentExePath?.() ??
    (process.platform === "win32" ? process.execPath : resolveInstalledAgentExePath());

  if (pid === currentPid) {
    return true;
  }
  if (!alive(pid)) {
    return false;
  }
  const liveExe = getExe(pid);
  return isMjhAgentExecutablePath(liveExe, { currentExePath: currentExe });
}

/**
 * Atomically acquire a single-instance lock using O_EXCL create.
 *
 * Stale locks are auto-cleared when:
 * - PID is dead
 * - PID is alive but executable is NOT MJH-Printer-Agent.exe (Windows PID reuse)
 * - lock JSON is corrupt / legacy-unreadable
 *
 * Never requires a human to delete agent.lock.
 */
export class AgentLock {
  private held = false;
  private readonly deps: AgentLockDeps;

  constructor(
    private readonly filePath: string,
    private readonly version: string,
    deps: AgentLockDeps = {},
  ) {
    this.deps = deps;
  }

  async acquire(): Promise<AgentLockInfo> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const currentPid = this.deps.currentPid?.() ?? process.pid;
    const exePath =
      this.deps.currentExePath?.() ??
      (process.platform === "win32" ? process.execPath : resolveInstalledAgentExePath());
    const createdAt = this.deps.nowIso?.() ?? new Date().toISOString();

    const info: AgentLockInfo = {
      pid: currentPid,
      exePath,
      createdAt,
      version: this.version,
    };

    try {
      await this.createExclusive(info);
      this.held = true;
      return info;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : undefined;

      if (code !== "EEXIST") {
        throw error;
      }
    }

    const existing = await readAgentLock(this.filePath);
    if (existing && isLiveMjhAgentOwner(existing.pid, this.deps)) {
      throw new AgentAlreadyRunningError(existing.pid);
    }

    // Stale: dead PID, foreign PID reuse, corrupt/legacy without live agent — cleanup.
    await this.forceClear();

    try {
      await this.createExclusive(info);
      this.held = true;
      return info;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : undefined;

      if (code === "EEXIST") {
        // Last resort: overwrite in place when wx still fails (file marked read-only / ACL).
        await writeFile(this.filePath, `${JSON.stringify(info, null, 2)}\n`, "utf8");
        this.held = true;
        return info;
      }
      throw error;
    }
  }

  async release(): Promise<void> {
    if (!this.held) {
      return;
    }

    this.held = false;
    const currentPid = this.deps.currentPid?.() ?? process.pid;
    try {
      const current = await readAgentLock(this.filePath);
      if (current && current.pid !== currentPid) {
        return;
      }
      await unlink(this.filePath);
    } catch {
      // Best-effort cleanup.
    }
  }

  private async forceClear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch {
      // ignore — overwrite path handles residual file
    }
  }

  private async createExclusive(info: AgentLockInfo): Promise<void> {
    const handle = await open(this.filePath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(info, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
  }
}
