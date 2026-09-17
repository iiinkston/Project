import { loadConfig, loadFileConfig, resolveStatePath } from "./config.js";
import { logger } from "./logger.js";
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
  const state = new StateStore(resolveStatePath());
  const worker = new PrintWorker(config, state);

  const shutdown = () => {
    logger.info("[MJH] Shutting down...");
    worker.stop();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await worker.start();
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
