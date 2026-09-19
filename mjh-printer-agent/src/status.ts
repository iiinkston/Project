import { mkdir, rename, unlink, writeFile, readFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AgentStatus = {
  version: string;
  pid: number;
  startedAt: string;
  updatedAt: string;
  cloud: {
    online: boolean;
    version?: string;
    commit?: string;
    environment?: string;
    lastSuccessAt?: string;
    lastErrorAt?: string;
  };
  printer: {
    online: boolean;
    ip: string;
    port: number;
    lastSuccessAt?: string;
    lastErrorAt?: string;
  };
  worker: {
    lastPollAt?: string;
    lastClaimAt?: string;
    lastPrintAt?: string;
    lastAckAt?: string;
    lastError?: string;
  };
};

export class StatusStore {
  private status: AgentStatus;

  constructor(
    private readonly filePath: string,
    initial: AgentStatus,
  ) {
    this.status = {
      ...initial,
      updatedAt: initial.updatedAt || initial.startedAt || new Date().toISOString(),
    };
  }

  getSnapshot(): AgentStatus {
    return structuredClone(this.status);
  }

  async save(): Promise<void> {
    // Never persist secrets — status schema has no token field.
    this.status.updatedAt = new Date().toISOString();
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });
    const payload = `${JSON.stringify(this.status, null, 2)}\n`;
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, payload, "utf8");
    try {
      await rename(tempPath, this.filePath);
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : undefined;
      if (code === "EEXIST" || code === "EPERM" || code === "EACCES") {
        await unlink(this.filePath).catch(() => undefined);
        await rename(tempPath, this.filePath);
        return;
      }
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  async patch(mutator: (current: AgentStatus) => void): Promise<void> {
    mutator(this.status);
    await this.save();
  }
}

export async function readStatusFile(filePath: string): Promise<AgentStatus | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as AgentStatus;
    if (!parsed.updatedAt) {
      parsed.updatedAt = parsed.startedAt ?? "";
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Mark agent stopped in status.json (after agent:stop). Preserves last known printer ip/port when present. */
export async function writeStoppedStatus(filePath: string): Promise<void> {
  const previous = await readStatusFile(filePath);
  const now = new Date().toISOString();
  const status: AgentStatus = {
    version: previous?.version ?? "unknown",
    pid: 0,
    startedAt: previous?.startedAt ?? now,
    updatedAt: now,
    cloud: { online: false },
    printer: {
      online: false,
      ip: previous?.printer.ip ?? "",
      port: previous?.printer.port ?? 0,
    },
    worker: {
      ...previous?.worker,
      lastError: "stopped",
    },
  };
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const payload = `${JSON.stringify(status, null, 2)}\n`;
  const tempPath = `${filePath}.stop.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, payload, "utf8");
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES") {
      await unlink(filePath).catch(() => undefined);
      await rename(tempPath, filePath);
      return;
    }
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}
