import {
  loadConfig,
  type AppConfig,
} from "../config.js";
import { logger } from "../logger.js";
import { PrintWorker } from "../jobs/worker.js";
import { StateStore } from "../jobs/state-store.js";
import type { StatusStore } from "../status.js";
import { resolveStatePath } from "../config.js";
import { PrinterClient } from "../printer/printer.js";

export type AgentLifecycle = "UNBOUND" | "BOUND_INITIALIZING" | "RUNNING" | "ERROR";

export type ActivateBoundResult = {
  ok: boolean;
  lifecycle: AgentLifecycle;
  cloudOnline: boolean;
  printerOnline: boolean;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process-wide agent runtime: Local API always on; worker starts after bind
 * without restarting the process or Scheduled Task.
 */
export class AgentRuntime {
  private lifecycle: AgentLifecycle = "UNBOUND";
  private worker: PrintWorker | null = null;
  private workerLoop: Promise<void> | null = null;
  private applyChain: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(private readonly status: StatusStore) {}

  getLifecycle(): AgentLifecycle {
    return this.lifecycle;
  }

  isWorkerRunning(): boolean {
    return this.worker !== null && this.lifecycle === "RUNNING";
  }

  /**
   * After printer.json has token written: stop any old worker, start exactly one.
   * Serialized — concurrent bind/rebind cannot create two claim loops.
   */
  activateBound(): Promise<ActivateBoundResult> {
    const run = this.applyChain.then(() => this.activateBoundExclusive());
    this.applyChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async activateBoundExclusive(): Promise<ActivateBoundResult> {
    const gen = ++this.generation;
    this.lifecycle = "BOUND_INITIALIZING";
    logger.info("[MJH] Bound credentials applied — initializing worker", "STARTUP");

    try {
      await this.stopWorkerInternal();
      if (gen !== this.generation) {
        return {
          ok: false,
          lifecycle: this.lifecycle,
          cloudOnline: false,
          printerOnline: false,
          error: "supplanted by newer bind",
        };
      }

      let config: AppConfig;
      try {
        config = loadConfig();
      } catch (error) {
        this.lifecycle = "ERROR";
        const message = error instanceof Error ? error.message : String(error);
        await this.status.patch((s) => {
          s.cloud.online = false;
          s.worker.lastError = message.slice(0, 200);
        });
        return {
          ok: false,
          lifecycle: "ERROR",
          cloudOnline: false,
          printerOnline: false,
          error: message,
        };
      }

      await this.status.patch((s) => {
        s.printer.ip = config.printer.ip;
        s.printer.port = config.printer.port;
        s.worker.lastError = undefined;
      });

      await this.probePrinter(config);

      const state = new StateStore(resolveStatePath());
      const worker = new PrintWorker(config, state, { status: this.status });
      this.worker = worker;
      this.lifecycle = "RUNNING";

      this.workerLoop = worker.start().catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[MJH] Worker loop ended: ${message}`, "WORKER_ERROR");
        if (this.worker === worker) {
          this.lifecycle = "ERROR";
          await this.status.patch((s) => {
            s.cloud.online = false;
            s.worker.lastError = message.slice(0, 200);
          });
        }
      });

      // Wait briefly for first cloud auth / health so Client is not lied to.
      const ready = await this.waitForCloudSignal(15_000, gen);
      return {
        ok: true,
        lifecycle: this.lifecycle,
        cloudOnline: ready.cloudOnline,
        printerOnline: ready.printerOnline,
        error: ready.error,
      };
    } catch (error) {
      this.lifecycle = "ERROR";
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[MJH] activateBound failed: ${message}`, "STARTUP");
      await this.status.patch((s) => {
        s.cloud.online = false;
        s.worker.lastError = message.slice(0, 200);
      });
      return {
        ok: false,
        lifecycle: "ERROR",
        cloudOnline: false,
        printerOnline: false,
        error: message,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.generation += 1;
    await this.stopWorkerInternal();
    this.lifecycle = "UNBOUND";
  }

  private async stopWorkerInternal(): Promise<void> {
    const current = this.worker;
    const loop = this.workerLoop;
    this.worker = null;
    this.workerLoop = null;
    if (!current) {
      return;
    }
    logger.info("[MJH] Stopping print worker for credential reload", "SHUTDOWN");
    current.stop();
    if (loop) {
      await Promise.race([loop, sleep(8_000)]);
    }
  }

  private async probePrinter(config: AppConfig): Promise<void> {
    const probe = new PrinterClient(config.printer);
    try {
      await probe.testConnection();
      await this.status.patch((s) => {
        s.printer.online = true;
        s.printer.ip = config.printer.ip;
        s.printer.port = config.printer.port;
        s.printer.lastSuccessAt = new Date().toISOString();
      });
      logger.info("[MJH] Printer probe OK after bind", "PRINTER_ONLINE");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.status.patch((s) => {
        s.printer.online = false;
        s.printer.ip = config.printer.ip;
        s.printer.port = config.printer.port;
        s.printer.lastErrorAt = new Date().toISOString();
        // Do not overwrite worker.lastError — reserved for cloud/auth failures (AUTH_FAILED).
      });
      logger.warn(`[MJH] Printer probe failed after bind: ${message}`, "PRINTER_OFFLINE");
    }
  }

  private async waitForCloudSignal(
    timeoutMs: number,
    gen: number,
  ): Promise<{ cloudOnline: boolean; printerOnline: boolean; error?: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && gen === this.generation) {
      const snap = this.status.getSnapshot();
      const err = snap.worker.lastError ?? "";
      if (snap.cloud.online) {
        return {
          cloudOnline: true,
          printerOnline: Boolean(snap.printer.online),
        };
      }
      if (err.startsWith("AUTH_FAILED")) {
        return {
          cloudOnline: false,
          printerOnline: Boolean(snap.printer.online),
          error: err,
        };
      }
      await sleep(400);
    }
    const snap = this.status.getSnapshot();
    return {
      cloudOnline: Boolean(snap.cloud.online),
      printerOnline: Boolean(snap.printer.online),
      error: snap.worker.lastError,
    };
  }
}

let runtimeSingleton: AgentRuntime | null = null;

export function setAgentRuntime(runtime: AgentRuntime | null): void {
  runtimeSingleton = runtime;
}

export function getAgentRuntime(): AgentRuntime | null {
  return runtimeSingleton;
}
