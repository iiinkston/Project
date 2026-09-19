import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const completedEntrySchema = z.object({
  kitchenSentAt: z.string().optional(),
  cashierSentAt: z.string().optional(),
  printedAt: z.string().min(1).optional(),
  acknowledged: z.boolean(),
}).passthrough();

const stateSchema = z.object({
  completed: z.record(z.string(), completedEntrySchema),
});

export type CompletedEntry = {
  kitchenSentAt?: string;
  cashierSentAt?: string;
  printedAt?: string;
  acknowledged: boolean;
};

export type PrintState = {
  completed: Record<string, CompletedEntry>;
};

function normalizeEntry(raw: z.infer<typeof completedEntrySchema>): CompletedEntry {
  const kitchenSentAt = raw.kitchenSentAt;
  const cashierSentAt = raw.cashierSentAt;
  let printedAt = raw.printedAt;

  // Backward compatibility: old entries only had printedAt + acknowledged.
  if (!printedAt && kitchenSentAt && cashierSentAt) {
    printedAt = cashierSentAt;
  }
  if (printedAt && !kitchenSentAt && !cashierSentAt) {
    // Treat legacy "printed" as both copies already sent.
    return {
      kitchenSentAt: printedAt,
      cashierSentAt: printedAt,
      printedAt,
      acknowledged: raw.acknowledged,
    };
  }

  return {
    kitchenSentAt,
    cashierSentAt,
    printedAt,
    acknowledged: raw.acknowledged,
  };
}

export class StateStore {
  private state: PrintState = { completed: {} };
  private loaded = false;

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const json: unknown = JSON.parse(raw);
      const parsed = stateSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(`Invalid print-state.json: ${parsed.error.message}`);
      }

      const completed: Record<string, CompletedEntry> = {};
      for (const [jobId, entry] of Object.entries(parsed.data.completed)) {
        completed[jobId] = normalizeEntry(entry);
      }
      this.state = { completed };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as NodeJS.ErrnoException).code)
          : undefined;

      if (code === "ENOENT") {
        this.state = { completed: {} };
      } else {
        throw error;
      }
    }

    this.loaded = true;
  }

  getCompleted(jobId: string): CompletedEntry | undefined {
    this.ensureLoaded();
    return this.state.completed[jobId];
  }

  isPrinted(jobId: string): boolean {
    const entry = this.getCompleted(jobId);
    if (!entry) {
      return false;
    }
    if (entry.printedAt) {
      return true;
    }
    return Boolean(entry.kitchenSentAt && entry.cashierSentAt);
  }

  needsAck(jobId: string): boolean {
    const entry = this.getCompleted(jobId);
    return entry !== undefined && this.isPrinted(jobId) && entry.acknowledged === false;
  }

  needsKitchen(jobId: string): boolean {
    const entry = this.getCompleted(jobId);
    return !entry?.kitchenSentAt;
  }

  needsCashier(jobId: string): boolean {
    const entry = this.getCompleted(jobId);
    return !entry?.cashierSentAt;
  }

  async markKitchenSent(jobId: string, at: string = new Date().toISOString()): Promise<void> {
    this.ensureLoaded();
    const prev = this.state.completed[jobId];
    this.state.completed[jobId] = {
      kitchenSentAt: at,
      cashierSentAt: prev?.cashierSentAt,
      printedAt: prev?.printedAt,
      acknowledged: prev?.acknowledged ?? false,
    };
    await this.persist();
  }

  async markCashierSent(jobId: string, at: string = new Date().toISOString()): Promise<void> {
    this.ensureLoaded();
    const prev = this.state.completed[jobId];
    this.state.completed[jobId] = {
      kitchenSentAt: prev?.kitchenSentAt,
      cashierSentAt: at,
      printedAt: prev?.printedAt,
      acknowledged: prev?.acknowledged ?? false,
    };
    await this.persist();
  }

  async markPrinted(jobId: string, printedAt: string = new Date().toISOString()): Promise<void> {
    this.ensureLoaded();
    const prev = this.state.completed[jobId];
    this.state.completed[jobId] = {
      kitchenSentAt: prev?.kitchenSentAt ?? printedAt,
      cashierSentAt: prev?.cashierSentAt ?? printedAt,
      printedAt,
      acknowledged: false,
    };
    await this.persist();
  }

  async markAcknowledged(jobId: string): Promise<void> {
    this.ensureLoaded();
    const entry = this.state.completed[jobId];
    if (!entry) {
      throw new Error(`Cannot acknowledge unknown job ${jobId}`);
    }
    this.state.completed[jobId] = {
      ...entry,
      acknowledged: true,
    };
    await this.persist();
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      throw new Error("StateStore.load() must be called before use");
    }
  }

  private async persist(): Promise<void> {
    const dir = dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const payload = `${JSON.stringify(this.state, null, 2)}\n`;
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
        await unlink(this.filePath);
        await rename(tempPath, this.filePath);
        return;
      }

      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}
