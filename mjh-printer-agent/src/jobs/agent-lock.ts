import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

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

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    // EPERM: process exists but we cannot signal it — treat as alive.
    if (code === "EPERM") {
      return true;
    }
    return false;
  }
}

async function readLock(filePath: string): Promise<AgentLockInfo | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentLockInfo>;
    if (typeof parsed.pid !== "number") {
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
 * Stale locks (dead PID) are removed and acquisition retried once.
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

    const existing = await readLock(this.filePath);
    if (existing && isPidAlive(existing.pid)) {
      throw new AgentAlreadyRunningError(existing.pid);
    }

    // Stale lock — remove and retry exclusive create once.
    await unlink(this.filePath).catch(() => undefined);

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
        const raced = await readLock(this.filePath);
        throw new AgentAlreadyRunningError(raced?.pid ?? 0);
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
      const current = await readLock(this.filePath);
      if (current && current.pid !== process.pid) {
        return;
      }
      await unlink(this.filePath);
    } catch {
      // Best-effort cleanup.
    }
  }

  private async createExclusive(info: AgentLockInfo): Promise<void> {
    // 'wx' => O_WRONLY | O_CREAT | O_EXCL (atomic create-if-absent)
    const handle = await open(this.filePath, "wx");
    try {
      await handle.writeFile(`${JSON.stringify(info, null, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
  }
}
