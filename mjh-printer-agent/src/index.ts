import {
  hasTokenConfigured,
  loadConfig,
  loadFileConfig,
  readPackageVersion,
  resolveAgentTokenSource,
  resolveLockPath,
  resolveStatePath,
  resolveStatusPath,
} from "./config.js";
import { configureLogger, logger } from "./logger.js";
import { AgentAlreadyRunningError, AgentLock } from "./jobs/agent-lock.js";
import { PrintWorker } from "./jobs/worker.js";
import { StateStore } from "./jobs/state-store.js";
import { StatusStore } from "./status.js";
import { resolveRuntimePaths } from "./paths.js";
import {
  runAgentDiagnose,
  runAgentStatus,
  runAgentStop,
  runConfigCheck,
  runConfigFixAcl,
  runConfigSet,
  runConfigShow,
  runDoctor,
  runLogsPath,
  runVersion,
} from "./cli/commands.js";
import { resolveCommand, resolveDoctorFlags, resolveAgentStartDryRun } from "./cli/resolve-command.js";
import { AGENT_BUILD } from "./version.js";
import { markCurrentAsAgentProcess } from "./process/agent-process.js";
import { runTestPrint } from "./printer/run-test-print.js";
import { startLocalHttpServer, type LocalHttpServer } from "./local/http-server.js";
import "./printer/encodings-ensure.js";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function runPrinterTest(): Promise<void> {
  const { printer } = loadFileConfig();
  logger.info(`[Printer] ${printer.model}`);
  logger.info(`[Printer] ${printer.ip}:${printer.port}`);
  logger.info("[Printer] Checking connection...");

  const result = await runTestPrint();
  if (!result.ok) {
    logger.error("[Printer] Offline or print failed");
    logger.error(result.message);
    process.exitCode = 1;
    return;
  }
  logger.info("[Printer] Online");
  logger.info(`[Printer] ${result.message}`);
}

async function runAgent(options: { dryRun?: boolean } = {}): Promise<void> {
  markCurrentAsAgentProcess();

  const paths = resolveRuntimePaths();
  configureLogger({ logsDir: paths.logsDir, retentionDays: 14, alsoConsole: true });

  const file = loadFileConfig(paths.configPath);
  const unbound = !hasTokenConfigured(file);

  // Unbound agents still expose Local API for wizard bind; skip cloud worker.
  let config: ReturnType<typeof loadConfig> | null = null;
  if (!unbound) {
    config = loadConfig(paths.configPath);
    configureLogger({ logsDir: config.logsDir, retentionDays: 14, alsoConsole: true });
  } else {
    configureLogger({ logsDir: paths.logsDir, retentionDays: 14, alsoConsole: true });
  }

  const version = config?.version ?? readPackageVersion();
  const lock = new AgentLock(resolveLockPath(), version);

  try {
    await lock.acquire();
  } catch (error) {
    if (error instanceof AgentAlreadyRunningError) {
      logger.error("[MJH] Printer Agent already running", "STARTUP");
      logger.error(`[MJH] Existing PID: ${error.existingPid}`, "STARTUP");
      logger.error("[MJH] Exiting", "STARTUP");
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const release = async () => {
    await lock.release();
  };

  const startedAt = new Date().toISOString();
  const status = new StatusStore(resolveStatusPath(), {
    version,
    pid: process.pid,
    startedAt,
    updatedAt: startedAt,
    cloud: { online: false },
    printer: {
      online: false,
      ip: file.printer.ip,
      port: file.printer.port,
    },
    worker: {},
  });
  await status.save();
  logger.info(`[MJH] status.json written pid=${process.pid}`, "STARTUP");

  if (options.dryRun) {
    logger.info("[MJH] Dry-run startup OK", "STARTUP");
    logger.info(`[MJH] Lock: ${resolveLockPath()}`, "STARTUP");
    logger.info(`[MJH] Status: ${resolveStatusPath()}`, "STARTUP");
    const lockOk = existsSync(resolveLockPath());
    const statusOk = existsSync(resolveStatusPath());
    if (!lockOk || !statusOk) {
      logger.error("[MJH] Dry-run failed: lock/status missing", "STARTUP");
      process.exitCode = 1;
      await release();
      return;
    }
    await mkdir(paths.dataDir, { recursive: true });
    await writeFile(
      join(paths.dataDir, "dry-run-ok.json"),
      `${JSON.stringify({ pid: process.pid, startedAt, version }, null, 2)}\n`,
      "utf8",
    );
    console.log("DRY-RUN PASS");
    console.log(`lock=${resolveLockPath()}`);
    console.log(`status=${resolveStatusPath()}`);
    console.log(`pid=${process.pid}`);
    await release();
    return;
  }

  logger.info("[MJH] Printer Agent starting", "STARTUP");
  logger.info(`[MJH] Version: ${version}`, "STARTUP");
  logger.info(`[MJH] Build: ${AGENT_BUILD}`, "STARTUP");
  logger.info(`[MJH] PID: ${process.pid}`, "STARTUP");
  logger.info(`[MJH] Started: ${startedAt}`, "STARTUP");
  logger.info("[MJH] Config loaded", "STARTUP");
  logger.info(`[MJH] Config: ${paths.configPath}`, "STARTUP");
  logger.info(`[MJH] Cloud: ${file.cloud.baseUrl}`, "STARTUP");
  logger.info(`[MJH] Agent: ${file.agent.id}`, "STARTUP");
  logger.info(`[MJH] Store: ${file.store.id}`, "STARTUP");
  if (unbound) {
    logger.info("waiting for binding", "STARTUP");
  } else if (config) {
    logger.info(`[MJH] Token source: ${resolveAgentTokenSource(config)}`, "STARTUP");
  }
  logger.info(
    `[MJH] Printer: ${file.printer.model} @ ${file.printer.ip}:${file.printer.port}`,
    "STARTUP",
  );
  logger.info(`[MJH] Data: ${paths.dataDir}`, "STARTUP");
  logger.info(`[MJH] Logs: ${paths.logsDir}`, "STARTUP");

  let localApi: LocalHttpServer | undefined;
  try {
    localApi = await startLocalHttpServer();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`[MJH] Local API failed to start: ${message}`, "STARTUP");
  }

  const state = config ? new StateStore(resolveStatePath()) : null;
  const worker = config && state ? new PrintWorker(config, state, { status }) : null;

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("[MJH] Shutting down...", "SHUTDOWN");
    worker?.stop();
    if (localApi) {
      try {
        await localApi.close();
      } catch {
        // ignore
      }
    }
    try {
      await status.patch((s) => {
        s.cloud.online = false;
        s.printer.online = false;
        s.worker.lastError = "shutdown";
      });
    } catch {
      // ignore
    }
    await release();
    logger.info("[MJH] Shutdown complete", "SHUTDOWN");
  };

  process.once("SIGINT", () => {
    void shutdown().then(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void shutdown().then(() => process.exit(0));
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error(`[MJH] unhandledRejection: ${message}`, "WORKER_ERROR");
  });
  process.on("uncaughtException", (error) => {
    logger.error(`[MJH] uncaughtException: ${error.message}`, "WORKER_ERROR");
    void shutdown().finally(() => process.exit(1));
  });

  if (!worker) {
    logger.info("[MJH] Unbound mode: Local API only (no cloud poll until bind)", "STARTUP");
    await new Promise<void>(() => {
      // Keep process alive until signal
    });
    return;
  }

  try {
    await worker.start();
  } finally {
    await shutdown();
  }
}

export { resolveCommand };

export async function main(argv: string[] = process.argv): Promise<void> {
  const command = resolveCommand(argv);

  switch (command) {
    case "agent:start":
      await runAgent({ dryRun: resolveAgentStartDryRun(argv) });
      break;
    case "agent:stop": {
      const result = await runAgentStop();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "agent:status": {
      const result = await runAgentStatus();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "agent:diagnose": {
      const result = await runAgentDiagnose();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "printer:test":
      await runPrinterTest();
      break;
    case "version":
      for (const line of runVersion()) console.log(line);
      break;
    case "doctor": {
      const flags = resolveDoctorFlags(argv);
      const result = await runDoctor(flags);
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "config:check": {
      const result = runConfigCheck();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "config:show": {
      const result = runConfigShow();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "config:set": {
      const result = await runConfigSet(argv);
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "config:fix-acl": {
      const result = await runConfigFixAcl();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    case "logs:path": {
      const result = runLogsPath();
      for (const line of result.lines) console.log(line);
      process.exitCode = result.exitCode;
      break;
    }
    default:
      logger.error(`Unknown command: ${command}`);
      logger.error(
        "Usage: MJH-Printer-Agent.exe [agent:start|agent:stop|agent:status|agent:diagnose|printer:test|version|doctor|config:check|config:show|config:set|config:fix-acl|logs:path]",
      );
      process.exitCode = 1;
  }
}

function isExecutedAsMain(): boolean {
  const proc = process as NodeJS.Process & { pkg?: unknown };
  if (proc.pkg || process.env.MJH_PACKAGED === "1") {
    return true;
  }
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return entry.includes("index");
  }
}

if (isExecutedAsMain()) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("[MJH] Fatal error", "STARTUP");
    logger.error(message, "STARTUP");
    process.exitCode = 1;
  });
}
