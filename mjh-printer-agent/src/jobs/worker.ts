import type { AppConfig } from "../config.js";
import { ApiClient } from "../cloud/api-client.js";
import type { PrintJob } from "../cloud/types.js";
import { logger } from "../logger.js";
import { PrinterClient } from "../printer/printer.js";
import { buildCashierReceiptV2, buildKitchenReceiptV2, isV2Payload } from "../printer/receipt.js";
import type { StatusStore } from "../status.js";
import { StateStore } from "./state-store.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cloud rejected Bearer token — keep process alive; do not wipe config. */
export function isCloudAuthError(error: unknown): boolean {
  const message = errorMessage(error);
  return (
    /HTTP 401\b/.test(message) ||
    /PRINTER_UNAUTHORIZED/i.test(message) ||
    /Invalid printer agent credentials/i.test(message)
  );
}

function cloudErrorForStatus(error: unknown): string {
  if (isCloudAuthError(error)) {
    return `AUTH_FAILED: ${errorMessage(error).slice(0, 180)}`;
  }
  return errorMessage(error).slice(0, 200);
}

async function smallPrinterSafeDelay(): Promise<void> {
  await sleep(400);
}

const CLOUD_RETRY_STEPS_MS = [5_000, 10_000, 30_000, 60_000];

export type PrintWorkerDeps = {
  api?: ApiClient;
  createPrinter?: (config: AppConfig["printer"]) => PrinterClient;
  status?: StatusStore;
};

export class PrintWorker {
  private readonly api: ApiClient;
  private readonly state: StateStore;
  private readonly config: AppConfig;
  private readonly createPrinter: (config: AppConfig["printer"]) => PrinterClient;
  private readonly status?: StatusStore;
  private running = false;
  private busy = false;
  private cloudRetryAttempt = 0;

  constructor(config: AppConfig, state: StateStore, deps: PrintWorkerDeps = {}) {
    this.config = config;
    this.state = state;
    this.status = deps.status;
    this.api =
      deps.api ??
      new ApiClient({
        baseUrl: config.cloud.baseUrl,
        token: config.cloud.token,
        storeId: config.store.id,
        agentId: config.agent.id,
        requestTimeoutMs: config.cloud.requestTimeoutMs,
      });
    this.createPrinter = deps.createPrinter ?? ((printer) => new PrinterClient(printer));
  }

  private lastHeartbeatAt = 0;

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.state.load();

    await this.waitForCloudAndPrinter();

    logger.info("[MJH] Waiting for print jobs...", "STARTUP");

    while (this.running) {
      try {
        await this.maybeHeartbeat();
        await this.pollOnce();
      } catch (error) {
        logger.error(`[MJH] Unexpected worker error: ${errorMessage(error)}`, "WORKER_ERROR");
        await this.status?.patch((s) => {
          s.worker.lastError = errorMessage(error).slice(0, 200);
        });
        await sleep(this.config.agent.pollIntervalMs);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async maybeHeartbeat(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHeartbeatAt < 60_000) {
      return;
    }
    this.lastHeartbeatAt = now;

    const probe = this.createPrinter(this.config.printer);
    try {
      await probe.testConnection();
      await this.status?.patch((s) => {
        s.printer.online = true;
        s.printer.lastSuccessAt = new Date().toISOString();
      });
    } catch (error) {
      await this.status?.patch((s) => {
        s.printer.online = false;
        s.printer.lastErrorAt = new Date().toISOString();
        s.worker.lastError = errorMessage(error).slice(0, 200);
      });
    }

    // Always refresh updatedAt even if printer state unchanged.
    await this.status?.patch(() => undefined);
  }

  private nextCloudBackoffMs(): number {
    const idx = Math.min(this.cloudRetryAttempt, CLOUD_RETRY_STEPS_MS.length - 1);
    this.cloudRetryAttempt += 1;
    return CLOUD_RETRY_STEPS_MS[idx] ?? 60_000;
  }

  private async waitForCloudAndPrinter(): Promise<void> {
    while (this.running) {
      let cloudOk = false;
      let printerOk = false;

      try {
        const health = await this.api.health();
        logger.info("[MJH] Cloud reachable", "CLOUD_CONNECTED");
        if (health.version) {
          logger.info(`[MJH] Cloud version: ${health.version}`, "CLOUD_CONNECTED");
        }
        await this.status?.patch((s) => {
          s.cloud.online = true;
          s.cloud.version = health.version;
          s.cloud.commit = health.commit;
          s.cloud.environment = health.environment;
          s.cloud.lastSuccessAt = new Date().toISOString();
        });

        await this.api.claimJob();
        cloudOk = true;
        this.cloudRetryAttempt = 0;
        logger.info("[MJH] Cloud authenticated", "CLOUD_CONNECTED");
        await this.status?.patch((s) => {
          s.cloud.online = true;
          s.cloud.lastSuccessAt = new Date().toISOString();
          s.worker.lastError = undefined;
        });
      } catch (error) {
        logger.warn(`[WARN] Cloud unavailable: ${errorMessage(error)}`, "CLOUD_DISCONNECTED");
        await this.status?.patch((s) => {
          s.cloud.online = false;
          s.cloud.lastErrorAt = new Date().toISOString();
          s.worker.lastError = cloudErrorForStatus(error);
        });
      }

      const probe = this.createPrinter(this.config.printer);
      try {
        await probe.testConnection();
        printerOk = true;
        logger.info("[MJH] Printer online", "PRINTER_ONLINE");
        await this.status?.patch((s) => {
          s.printer.online = true;
          s.printer.lastSuccessAt = new Date().toISOString();
        });
      } catch (error) {
        logger.warn(`[WARN] Printer offline: ${errorMessage(error)}`, "PRINTER_OFFLINE");
        await this.status?.patch((s) => {
          s.printer.online = false;
          s.printer.lastErrorAt = new Date().toISOString();
        });
      }

      if (cloudOk && printerOk) {
        this.lastHeartbeatAt = Date.now();
        return;
      }

      const waitMs = this.nextCloudBackoffMs();
      logger.warn(`[MJH] Retrying startup checks in ${waitMs}ms`, "STARTUP");
      await sleep(waitMs);
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.busy) {
      await sleep(this.config.agent.pollIntervalMs);
      return;
    }

    this.busy = true;
    try {
      await this.status?.patch((s) => {
        s.worker.lastPollAt = new Date().toISOString();
      });

      let job: PrintJob | null;
      try {
        job = await this.api.claimJob();
        this.cloudRetryAttempt = 0;
        await this.status?.patch((s) => {
          s.cloud.online = true;
          s.cloud.lastSuccessAt = new Date().toISOString();
          s.worker.lastError = undefined;
        });
      } catch (error) {
        logger.error(`[MJH] Claim failed: ${errorMessage(error)}`, "CLOUD_DISCONNECTED");
        await this.status?.patch((s) => {
          s.cloud.online = false;
          s.cloud.lastErrorAt = new Date().toISOString();
          s.worker.lastError = cloudErrorForStatus(error);
        });
        await sleep(this.nextCloudBackoffMs());
        return;
      }

      if (!job) {
        await sleep(this.config.agent.pollIntervalMs);
        return;
      }

      await this.handleJob(job);
    } finally {
      this.busy = false;
    }
  }

  private async handleJob(job: PrintJob): Promise<void> {
    const tag = `[Job ${job.id}]`;
    logger.info(`${tag} Claimed order=${job.payload.orderNumber}`, "JOB_CLAIMED");
    await this.status?.patch((s) => {
      s.worker.lastClaimAt = new Date().toISOString();
    });

    if (this.state.isPrinted(job.id) && this.state.needsAck(job.id)) {
      logger.info(`${tag} Already printed locally — retrying cloud ACK only`, "JOB_CLAIMED");
      await this.acknowledge(job.id, tag, job.payload.orderNumber);
      return;
    }

    if (this.state.isPrinted(job.id) && !this.state.needsAck(job.id)) {
      logger.info(`${tag} Already printed and acknowledged — skipping`, "JOB_CLAIMED");
      return;
    }

    const printer = this.createPrinter(this.config.printer);

    try {
      await printer.testConnection();
      logger.info(`${tag} Printer online`, "PRINTER_ONLINE");
      await this.status?.patch((s) => {
        s.printer.online = true;
        s.printer.lastSuccessAt = new Date().toISOString();
      });
    } catch (error) {
      const message = errorMessage(error);
      logger.error(`${tag} Printer offline: ${message}`, "PRINTER_OFFLINE");
      await this.status?.patch((s) => {
        s.printer.online = false;
        s.printer.lastErrorAt = new Date().toISOString();
      });
      await this.safeFail(job.id, message, tag);
      await sleep(this.config.agent.pollIntervalMs);
      return;
    }

    const version = isV2Payload(job.payload) ? "V2" : "V1";
    logger.info(`${tag} Payload version=${version}`, "JOB_CLAIMED");

    try {
      await printer.connect();

      if (this.state.needsKitchen(job.id)) {
        logger.info(`${tag} Rendering kitchen copy`, "KITCHEN_PRINT_START");
        const kitchen = buildKitchenReceiptV2(job);
        logger.info(`${tag} Kitchen bytes=${kitchen.length}`, "KITCHEN_PRINT_START");
        logger.info(`${tag} Sending kitchen copy`, "KITCHEN_PRINT_START");
        await printer.send(kitchen);
        await this.state.markKitchenSent(job.id);
        logger.info(`${tag} Kitchen copy sent`, "KITCHEN_PRINTED");
        await smallPrinterSafeDelay();
      } else {
        logger.info(`${tag} Kitchen already sent — skipping reprint`, "KITCHEN_PRINTED");
      }

      if (this.state.needsCashier(job.id)) {
        logger.info(`${tag} Rendering cashier copy`, "CASHIER_PRINT_START");
        const cashier = buildCashierReceiptV2(job);
        logger.info(`${tag} Cashier bytes=${cashier.length}`, "CASHIER_PRINT_START");
        logger.info(`${tag} Sending cashier copy`, "CASHIER_PRINT_START");
        await printer.send(cashier);
        await this.state.markCashierSent(job.id);
        logger.info(`${tag} Cashier copy sent`, "CASHIER_PRINTED");
      } else {
        logger.info(`${tag} Cashier already sent — skipping reprint`, "CASHIER_PRINTED");
      }
    } catch (error) {
      const message = errorMessage(error);
      logger.error(`${tag} Print failed: ${message}`, "JOB_FAILED");
      // Only fail cloud if neither copy was sent; otherwise keep job for resume/ACK.
      const entry = this.state.getCompleted(job.id);
      if (!entry?.kitchenSentAt && !entry?.cashierSentAt) {
        await this.safeFail(job.id, message, tag);
      }
      await sleep(this.config.agent.pollIntervalMs);
      return;
    } finally {
      await printer.close();
    }

    await this.state.markPrinted(job.id);
    logger.info(`${tag} Printed both copies`, "JOB_COMPLETED");
    await this.status?.patch((s) => {
      s.worker.lastPrintAt = new Date().toISOString();
    });

    await this.acknowledge(job.id, tag, job.payload.orderNumber);
  }

  async processClaimedJobForTest(job: PrintJob): Promise<void> {
    await this.state.load();
    await this.handleJob(job);
  }

  private async acknowledge(jobId: string, tag: string, orderNumber?: string): Promise<void> {
    try {
      await this.api.completeJob(jobId);
      await this.state.markAcknowledged(jobId);
      logger.info(
        `${tag} Cloud acknowledged${orderNumber ? ` order=${orderNumber}` : ""}`,
        "JOB_COMPLETED",
      );
      await this.status?.patch((s) => {
        s.worker.lastAckAt = new Date().toISOString();
      });
    } catch (error) {
      logger.error(`${tag} Cloud ACK failed (will retry on reclaim): ${errorMessage(error)}`, "JOB_FAILED");
    }
  }

  private async safeFail(jobId: string, error: string, tag: string): Promise<void> {
    try {
      await this.api.failJob(jobId, error);
      logger.info(`${tag} Reported failure to cloud`, "JOB_FAILED");
    } catch (failError) {
      logger.error(`${tag} Failed to report failure: ${errorMessage(failError)}`, "JOB_FAILED");
    }
  }
}
