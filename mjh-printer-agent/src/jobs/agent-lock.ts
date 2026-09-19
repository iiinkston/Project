import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isMjhAgentPid, isPidAlive, listRelevantProcesses } from "../process/agent-process.js";

function isClassifiedForeignProcess(pid: number): boolean {
  const hit = listRelevantProcesses().find((p) => p.pid === pid);
  return Boolean(hit && !hit.isMjhAgent);
}

export type AgentLockInfo = {
  pid: number;
  startedAt: string;
  version: string;
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
    const parsed = JSON.parse(raw) as Partial<AgentLockInfo>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    return {
      pid: parsed.pid,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      version: typeof parsed.version === "string" ? parsed.version : "",
    };
  } catch {
    return null;
  }
}

/**
 * Atomically acquire a single-instance lock using O_EXCL create.
 * Stale / unreadable / ACL-blocked locks are cleared when no live agent exists.
 */
export class AgentLock {
  private held = false;

  constructor(
    private readonly filePath: string,
    private readonly version: string,
  ) {}

  async acquire(): Promise<AgentLockInfo> {
    await mkdir(dirname(this.filePath), { recursive: true });

    const info: AgentLockInfo = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
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
    if (existing && isPidAlive(existing.pid)) {
      const foreign = isClassifiedForeignProcess(existing.pid);
      if (existing.pid === process.pid || isMjhAgentPid(existing.pid) || !foreign) {
        throw new AgentAlreadyRunningError(existing.pid);
      }
    }

    // No live owner for this lock file — force-clear stale/unreadable lock.
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
    try {
      const current = await readAgentLock(this.filePath);
      if (current && current.pid !== process.pid) {
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
