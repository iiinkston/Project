import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

const completedEntrySchema = z.object({
  printedAt: z.string().min(1),
  acknowledged: z.boolean(),
});

const stateSchema = z.object({
  completed: z.record(z.string(), completedEntrySchema),
});

export type CompletedEntry = z.infer<typeof completedEntrySchema>;
export type PrintState = z.infer<typeof stateSchema>;

const EMPTY_STATE: PrintState = { completed: {} };

export class StateStore {
  private state: PrintState = EMPTY_STATE;
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
      this.state = parsed.data;
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
    return this.getCompleted(jobId) !== undefined;
  }

  needsAck(jobId: string): boolean {
    const entry = this.getCompleted(jobId);
    return entry !== undefined && entry.acknowledged === false;
  }

  async markPrinted(jobId: string, printedAt: string = new Date().toISOString()): Promise<void> {
    this.ensureLoaded();
    this.state.completed[jobId] = {
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
      // Windows cannot rename over an existing file — replace explicitly.
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
