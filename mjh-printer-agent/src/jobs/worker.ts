import type { AppConfig } from "../config.js";
import { ApiClient } from "../cloud/api-client.js";
import type { PrintJob } from "../cloud/types.js";
import { logger } from "../logger.js";
import { PrinterClient } from "../printer/printer.js";
import { buildCashierReceiptV2, buildKitchenReceiptV2, isV2Payload } from "../printer/receipt.js";
import { StateStore } from "./state-store.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Brief pause so XP-N160II can finish cut before the next init/print. */
async function smallPrinterSafeDelay(): Promise<void> {
  await sleep(400);
}

export type PrintWorkerDeps = {
  api?: ApiClient;
  createPrinter?: (config: AppConfig["printer"]) => PrinterClient;
};

export class PrintWorker {
  private readonly api: ApiClient;
  private readonly state: StateStore;
  private readonly config: AppConfig;
  private readonly createPrinter: (config: AppConfig["printer"]) => PrinterClient;
  private running = false;
  private busy = false;

  constructor(config: AppConfig, state: StateStore, deps: PrintWorkerDeps = {}) {
    this.config = config;
    this.state = state;
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

  async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.state.load();

    logger.info("[MJH] Printer Agent starting");
    logger.info(`[MJH] PID: ${process.pid}`);
    logger.info(`[MJH] Version: ${this.config.version}`);
    logger.info(`[MJH] Store: ${this.config.store.id}`);
    logger.info(`[MJH] Agent: ${this.config.agent.id}`);
    logger.info(
      `[MJH] Printer: ${this.config.printer.model} @ ${this.config.printer.ip}:${this.config.printer.port}`,
    );
    logger.info(`[MJH] Cloud: ${this.config.cloud.baseUrl}`);
    logger.info("[MJH] Waiting for print jobs...");

    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        logger.error(`[MJH] Unexpected worker error: ${errorMessage(error)}`);
        await sleep(this.config.agent.pollIntervalMs);
      }
    }
  }

  stop(): void {
    this.running = false;
  }

  private async pollOnce(): Promise<void> {
    if (this.busy) {
      await sleep(this.config.agent.pollIntervalMs);
      return;
    }

    this.busy = true;
    try {
      let job: PrintJob | null;
      try {
        job = await this.api.claimJob();
      } catch (error) {
        logger.error(`[MJH] Claim failed: ${errorMessage(error)}`);
        await sleep(this.config.agent.pollIntervalMs);
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
    logger.info(`${tag} Claimed order=${job.payload.orderNumber}`);

    if (this.state.isPrinted(job.id)) {
      logger.info(`${tag} Already printed locally — retrying cloud ACK only`);
      await this.acknowledge(job.id, tag);
      return;
    }

    const printer = this.createPrinter(this.config.printer);

    try {
      await printer.testConnection();
      logger.info(`${tag} Printer online`);
    } catch (error) {
      const message = errorMessage(error);
      logger.error(`${tag} Printer offline: ${message}`);
      await this.safeFail(job.id, message, tag);
      await sleep(this.config.agent.pollIntervalMs);
      return;
    }

    const version = isV2Payload(job.payload) ? "V2" : "V1";
    logger.info(`${tag} Payload version=${version}`);

    try {
      await printer.connect();

      logger.info(`${tag} Rendering kitchen copy`);
      const kitchen = buildKitchenReceiptV2(job);
      logger.info(`${tag} Kitchen bytes=${kitchen.length}`);
      logger.info(`${tag} Sending kitchen copy`);
      await printer.send(kitchen);
      logger.info(`${tag} Kitchen copy sent`);

      await smallPrinterSafeDelay();

      logger.info(`${tag} Rendering cashier copy`);
      const cashier = buildCashierReceiptV2(job);
      logger.info(`${tag} Cashier bytes=${cashier.length}`);
      logger.info(`${tag} Sending cashier copy`);
      await printer.send(cashier);
      logger.info(`${tag} Cashier copy sent`);
    } catch (error) {
      const message = errorMessage(error);
      logger.error(`${tag} Print failed: ${message}`);
      await this.safeFail(job.id, message, tag);
      await sleep(this.config.agent.pollIntervalMs);
      return;
    } finally {
      await printer.close();
    }

    await this.state.markPrinted(job.id);
    logger.info(`${tag} Printed both copies`);

    await this.acknowledge(job.id, tag);
  }

  /** Test helper: process a single already-claimed job without the poll loop. */
  async processClaimedJobForTest(job: PrintJob): Promise<void> {
    await this.state.load();
    await this.handleJob(job);
  }

  private async acknowledge(jobId: string, tag: string): Promise<void> {
    try {
      await this.api.completeJob(jobId);
      await this.state.markAcknowledged(jobId);
      logger.info(`${tag} Cloud acknowledged`);
    } catch (error) {
      logger.error(`${tag} Cloud ACK failed (will retry on reclaim): ${errorMessage(error)}`);
    }
  }

  private async safeFail(jobId: string, error: string, tag: string): Promise<void> {
    try {
      await this.api.failJob(jobId, error);
      logger.info(`${tag} Reported failure to cloud`);
    } catch (failError) {
      logger.error(`${tag} Failed to report failure: ${errorMessage(failError)}`);
    }
  }
}
