import {
  loadConfig,
  loadFileConfig,
  resolveLockPath,
  resolveStatePath,
} from "./config.js";
import { logger } from "./logger.js";
import { AgentAlreadyRunningError, AgentLock } from "./jobs/agent-lock.js";
import { PrintWorker } from "./jobs/worker.js";
import { StateStore } from "./jobs/state-store.js";
import { PrinterClient } from "./printer/printer.js";
import { buildKitchenTestReceipt } from "./printer/receipt.js";

async function runPrinterTest(): Promise<void> {
  const { printer } = loadFileConfig();
  const client = new PrinterClient(printer);

  logger.info(`[Printer] ${printer.model}`);
  logger.info(`[Printer] ${printer.ip}:${printer.port}`);
  logger.info("[Printer] Checking connection...");

  try {
    await client.testConnection();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[Printer] Offline");
    logger.error(message);
    process.exitCode = 1;
    return;
  }

  logger.info("[Printer] Online");
  logger.info("[Printer] Sending kitchen test receipt...");

  try {
    await client.connect();
    const receipt = buildKitchenTestReceipt();
    await client.send(receipt);
    logger.info("[Printer] Print job sent successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[Printer] Print failed");
    logger.error(message);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

async function runAgent(): Promise<void> {
  const config = loadConfig();
  const lock = new AgentLock(resolveLockPath(), config.version);

  try {
    await lock.acquire();
  } catch (error) {
    if (error instanceof AgentAlreadyRunningError) {
      logger.error("[MJH] Printer Agent already running");
      logger.error(`[MJH] Existing PID: ${error.existingPid}`);
      logger.error("[MJH] Exiting");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const release = async () => {
    await lock.release();
  };

  process.once("exit", () => {
    // Sync best-effort is not available async; release is registered below for signals.
  });

  const state = new StateStore(resolveStatePath());
  const worker = new PrintWorker(config, state);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("[MJH] Shutting down...");
    worker.stop();
    await release();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("beforeExit", () => {
    void release();
  });

  try {
    await worker.start();
  } finally {
    await release();
  }
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "printer:test";

  switch (command) {
    case "printer:test":
      await runPrinterTest();
      break;
    case "agent:start":
      await runAgent();
      break;
    default:
      logger.error(`Unknown command: ${command}`);
      logger.error("Usage: tsx src/index.ts [printer:test|agent:start]");
      process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error("[MJH] Fatal error");
  logger.error(message);
  process.exitCode = 1;
});
