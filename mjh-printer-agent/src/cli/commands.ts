import { access, constants as fsConstants, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  loadFileConfig,
  hasTokenConfigured,
  resolveConfigPath,
  resolveLockPath,
  resolveStatePath,
  resolveStatusPath,
  resolveLogsDir,
  resolveAgentTokenDetails,
  hashTokenSha256,
  type FileConfig,
} from "../config.js";
import {
  applyProgramDataAcl,
  mergeFileConfig,
  parseConfigSetArgs,
  writeFileConfigAtomic,
} from "../config-write.js";
import { ApiClient } from "../cloud/api-client.js";
import { getProgramDataRoot, resolveRuntimePaths } from "../paths.js";
import { PrinterClient } from "../printer/printer.js";
import { readStatusFile, writeStoppedStatus } from "../status.js";
import { AGENT_BUILD, AGENT_VERSION } from "../version.js";
import type { DoctorFlags } from "./resolve-command.js";
import {
  findRunningAgentPids,
  isPidAlive,
  listRelevantProcesses,
  stopAgentProcesses,
} from "../process/agent-process.js";
import { readAgentLock } from "../jobs/agent-lock.js";

export type DoctorResult = {
  exitCode: 0 | 1 | 2;
  lines: string[];
};

async function pathWritable(dir: string): Promise<boolean> {
  try {
    await access(dir, fsConstants.W_OK);
    return true;
  } catch {
    try {
      await mkdir(dir, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function pathReadable(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function runningUserLabel(): string {
  if (process.platform === "win32") {
    try {
      return execFileSync("whoami", [], { encoding: "utf8", windowsHide: true }).trim();
    } catch {
      return process.env.USERNAME || "unknown";
    }
  }
  return process.env.USER || process.env.LOGNAME || "unknown";
}

function cloudErrorDetail(error: unknown): { httpStatus?: number; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/HTTP (\d{3})/);
  const httpStatus = match ? Number(match[1]) : undefined;
  const apiMessage = message.includes(": ")
    ? message.slice(message.lastIndexOf(": ") + 2).trim()
    : message;
  return { httpStatus, message: apiMessage || message };
}

export async function runDoctor(flags: DoctorFlags = { printerOnly: false }): Promise<DoctorResult> {
  const lines: string[] = [];
  lines.push("MJH Printer Agent Doctor");
  lines.push(`Agent version: ${AGENT_VERSION} (${AGENT_BUILD})`);
  lines.push(`Running user: ${runningUserLabel()}`);

  let exitCode: 0 | 1 | 2 = 0;
  let file;

  try {
    const configPath = resolveConfigPath();
    file = loadFileConfig(configPath);
    lines.push(`Config: OK (${configPath})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`Config: FAIL (${message})`);
    return { exitCode: 2, lines };
  }

  if (flags.printerOnly) {
    lines.push("");
    lines.push("Printer:");
    lines.push(`${file.printer.ip}:${file.printer.port}`);
    const printer = new PrinterClient(file.printer);
    try {
      await printer.testConnection();
      lines.push("ONLINE");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      lines.push("OFFLINE");
      lines.push(`detail: ${message.split("\n")[0]}`);
      exitCode = 1;
    }
    return { exitCode, lines };
  }

  const tokenOk = hasTokenConfigured(file);
  lines.push(`Token configured: ${tokenOk ? "YES" : "NO"}`);
  if (!tokenOk) {
    exitCode = 2;
  }

  const paths = resolveRuntimePaths();
  lines.push(`Data dir: ${paths.dataDir}`);
  lines.push(`Logs dir: ${paths.logsDir}`);

  lines.push("");
  lines.push("Permissions:");
  const logsRead = await pathReadable(paths.logsDir);
  const logsWrite = await pathWritable(paths.logsDir);
  const dataRead = await pathReadable(paths.dataDir);
  const dataWrite = await pathWritable(paths.dataDir);
  lines.push(`logs: READ ${logsRead ? "PASS" : "FAIL"}`);
  lines.push(`logs: WRITE ${logsWrite ? "PASS" : "FAIL"}`);
  lines.push(`data: READ ${dataRead ? "PASS" : "FAIL"}`);
  lines.push(`data: WRITE ${dataWrite ? "PASS" : "FAIL"}`);
  if (!logsRead || !logsWrite || !dataRead || !dataWrite) {
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  }

  lines.push("");
  lines.push("Cloud:");
  lines.push(`URL: ${file.cloud.baseUrl}`);

  let api: ApiClient | undefined;
  let doctorCloudOnline = false;
  if (tokenOk) {
    const { token, source } = resolveAgentTokenDetails(file);
    lines.push(`Token source: ${source}`);
    api = new ApiClient({
      baseUrl: file.cloud.baseUrl,
      token,
      storeId: file.store.id,
      agentId: file.agent.id,
      requestTimeoutMs: 8000,
    });
  }

  let reachable = false;
  try {
    if (!api) {
      throw new Error("Token not configured");
    }
    const health = await api.health();
    reachable = true;
    lines.push("Cloud reachable: PASS");
    lines.push(`health status: ${health.status}`);
    lines.push(`version: ${health.version ?? "n/a"}`);
    lines.push(`commit: ${health.commit ?? "n/a"}`);
    lines.push(`environment: ${health.environment ?? "n/a"}`);
  } catch (error) {
    const { httpStatus, message } = cloudErrorDetail(error);
    lines.push("Cloud reachable: FAIL");
    if (httpStatus !== undefined) {
      lines.push(`HTTP status: ${httpStatus}`);
    }
    lines.push(`response message: ${message}`);
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  }

  lines.push("");
  lines.push("Cloud authentication test:");
  if (!api) {
    lines.push("Printer agent authenticated: FAIL");
    lines.push("response message: Token not configured");
    exitCode = 2;
  } else {
    try {
      await api.claimJob();
      lines.push("Printer agent authenticated: PASS");
      doctorCloudOnline = reachable;
    } catch (error) {
      const { httpStatus, message } = cloudErrorDetail(error);
      lines.push("Printer agent authenticated: FAIL");
      if (httpStatus !== undefined) {
        lines.push(`HTTP status: ${httpStatus}`);
      }
      lines.push(`response message: ${message}`);
      if (httpStatus === 401 || httpStatus === 403) {
        exitCode = Math.max(exitCode, 2) as 0 | 1 | 2;
      } else {
        exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
      }
    }
  }

  lines.push("");
  lines.push("Printer:");
  lines.push(`${file.printer.ip}:${file.printer.port}`);
  let doctorPrinterOnline = false;
  const printer = new PrinterClient(file.printer);
  try {
    await printer.testConnection();
    lines.push("ONLINE");
    doctorPrinterOnline = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push("OFFLINE");
    lines.push(`detail: ${message.split("\n")[0]}`);
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  }

  lines.push("");
  lines.push("State:");
  lines.push(`state file: ${resolveStatePath()}`);
  lines.push(`lock file: ${resolveLockPath()}`);
  const status = await readStatusFile(resolveStatusPath());
  if (status) {
    lines.push(`status.json pid: ${status.pid}`);
    lines.push(`status.json updatedAt: ${status.updatedAt ?? "n/a"}`);
    lines.push(`status.json cloud state: ${status.cloud.online ? "online" : "offline"}`);
    lines.push(`actual doctor cloud state: ${doctorCloudOnline ? "online" : "offline"}`);
    if (Boolean(status.cloud.online) !== doctorCloudOnline) {
      lines.push("WARN: status.json cloud state mismatches doctor result");
      exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
    }
    lines.push(`status.json printer state: ${status.printer.online ? "online" : "offline"}`);
    lines.push(`actual doctor printer state: ${doctorPrinterOnline ? "online" : "offline"}`);
    if (Boolean(status.printer.online) !== doctorPrinterOnline) {
      lines.push("WARN: status.json printer state mismatches doctor result");
      exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
    }
  } else {
    lines.push("status.json: not present (agent may be stopped)");
  }

  lines.push("");
  lines.push("Detected Node processes:");
  try {
    const procs = listRelevantProcesses();
    if (procs.length === 0) {
      lines.push("(none)");
    } else {
      for (const p of procs) {
        lines.push(
          `  PID ${p.pid} ${p.name} → ${p.isMjhAgent ? "MJH Agent" : "NOT MJH (do not kill)"}`,
        );
      }
    }
  } catch {
    lines.push("(unable to enumerate)");
  }

  return { exitCode, lines };
}

export function runConfigCheck(): { exitCode: 0 | 2; lines: string[] } {
  const lines: string[] = [];
  lines.push("MJH Printer Agent config:check");

  try {
    const configPath = resolveConfigPath();
    const file = loadFileConfig(configPath);
    lines.push(`config path: ${configPath}`);
    lines.push("");
    lines.push("Cloud:");
    lines.push(file.cloud.baseUrl);
    lines.push("");
    lines.push("Agent:");
    lines.push(file.agent.id);
    lines.push(`store.id: ${file.store.id}`);
    lines.push("");
    lines.push("Token:");

    if (!hasTokenConfigured(file)) {
      lines.push("missing");
      lines.push("Token exists: NO");
      lines.push(`printer.ip: ${file.printer.ip}`);
      lines.push(`printer.port: ${file.printer.port}`);
      return { exitCode: 2, lines };
    }

    const { token, source } = resolveAgentTokenDetails(file);
    const hash = hashTokenSha256(token);
    lines.push("configured");
    lines.push(`Token exists: YES`);
    lines.push(`Token source: ${source}`);
    lines.push(`Token length: ${token.length}`);
    lines.push(`Token hash: ${hash}`);
    lines.push("");
    lines.push(`printer.ip: ${file.printer.ip}`);
    lines.push(`printer.port: ${file.printer.port}`);
    lines.push(`encoding: ${file.printer.encoding}`);

    // Never echo raw token.
    if (lines.some((line) => line.includes(token))) {
      throw new Error("internal: token leaked into config:check output");
    }

    return { exitCode: 0, lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`FAIL: ${message}`);
    return { exitCode: 2, lines };
  }
}

export function runVersion(): string[] {
  return [
    "MJH Printer Agent",
    `Version: ${AGENT_VERSION}`,
    `Build: ${AGENT_BUILD}`,
    `Platform: ${process.platform}-${process.arch}`,
  ];
}

export function runConfigShow(): { exitCode: 0 | 2; lines: string[] } {
  const lines: string[] = [];
  lines.push("MJH Printer Agent config:show");

  try {
    const configPath = resolveConfigPath();
    const file = loadFileConfig(configPath);
    lines.push(`config path: ${configPath}`);
    lines.push("");
    lines.push("Store:");
    lines.push(file.store.id);
    lines.push("");
    lines.push("Agent:");
    lines.push(file.agent.id);
    lines.push(`token configured: ${hasTokenConfigured(file) ? "YES" : "NO"}`);
    lines.push("");
    lines.push("Cloud:");
    lines.push(file.cloud.baseUrl);
    lines.push("");
    lines.push("Printer:");
    lines.push(`${file.printer.name} (${file.printer.model})`);
    lines.push(`${file.printer.ip}:${file.printer.port}`);
    lines.push(`encoding: ${file.printer.encoding}`);

    const text = lines.join("\n");
    if (file.agent.token && text.includes(file.agent.token)) {
      throw new Error("internal: token leaked into config:show output");
    }
    return { exitCode: 0, lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`FAIL: ${message}`);
    return { exitCode: 2, lines };
  }
}

export async function runConfigSet(argv: string[]): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }> {
  const lines: string[] = [];
  lines.push("MJH Printer Agent config:set");

  try {
    const patch = parseConfigSetArgs(argv.slice(3));
    if (
      patch.storeId === undefined &&
      patch.agentId === undefined &&
      patch.token === undefined &&
      patch.pollIntervalMs === undefined &&
      patch.cloudBaseUrl === undefined &&
      patch.printerIp === undefined &&
      patch.printerPort === undefined &&
      patch.printerName === undefined &&
      patch.printerModel === undefined &&
      patch.connectTimeoutMs === undefined
    ) {
      lines.push("FAIL: no options provided");
      lines.push(
        "Usage: config:set --store-id <id> --agent-id <id> --token <token> [--cloud-base-url <url>] [--printer-ip <ip>]",
      );
      return { exitCode: 2, lines };
    }

    const configPath = resolveConfigPath();
    let base: FileConfig;
    if (existsSync(configPath)) {
      base = loadFileConfig(configPath);
    } else {
      lines.push(`No existing config at ${configPath}; creating new file.`);
      base = {
        store: { id: patch.storeId || "CHANGE_ME" },
        agent: {
          id: patch.agentId || "kitchen-1",
          token: patch.token,
          pollIntervalMs: patch.pollIntervalMs ?? 3000,
        },
        printer: {
          name: patch.printerName || "Kitchen",
          model: patch.printerModel || "XP-N160II",
          ip: patch.printerIp || "192.168.0.110",
          port: patch.printerPort ?? 9100,
          encoding: "gb18030",
          connectTimeoutMs: patch.connectTimeoutMs ?? 3000,
        },
        cloud: {
          baseUrl: patch.cloudBaseUrl || "http://127.0.0.1/api/v1",
        },
      };
    }

    const merged = mergeFileConfig(base, patch);
    if (!merged.agent.token?.trim() && !hasTokenConfigured(merged)) {
      lines.push("WARN: token not set in config (env MJH_PRINTER_AGENT_TOKEN may be used at runtime)");
    }

    const { backupPath } = await writeFileConfigAtomic(configPath, merged);
    await applyProgramDataAcl(getProgramDataRoot());

    lines.push(`config path: ${configPath}`);
    if (backupPath) {
      lines.push(`backup: ${backupPath}`);
    } else {
      lines.push("backup: (none — new file)");
    }
    lines.push("updated fields:");
    if (patch.storeId !== undefined) lines.push(`  store.id`);
    if (patch.agentId !== undefined) lines.push(`  agent.id`);
    if (patch.token !== undefined) lines.push(`  agent.token (set, not displayed)`);
    if (patch.pollIntervalMs !== undefined) lines.push(`  agent.pollIntervalMs`);
    if (patch.cloudBaseUrl !== undefined) lines.push(`  cloud.baseUrl`);
    if (patch.printerIp !== undefined) lines.push(`  printer.ip`);
    if (patch.printerPort !== undefined) lines.push(`  printer.port`);
    if (patch.printerName !== undefined) lines.push(`  printer.name`);
    if (patch.printerModel !== undefined) lines.push(`  printer.model`);
    if (patch.connectTimeoutMs !== undefined) lines.push(`  printer.connectTimeoutMs`);
    lines.push("preserved: printer/cloud fields not listed above");
    lines.push("OK");

    if (patch.token && lines.some((l) => l.includes(patch.token!))) {
      throw new Error("internal: token leaked into config:set output");
    }

    return { exitCode: 0, lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`FAIL: ${message}`);
    return { exitCode: 2, lines };
  }
}

export async function runConfigFixAcl(): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }> {
  const lines: string[] = [];
  lines.push("MJH Printer Agent config:fix-acl");
  try {
    let running = findRunningAgentPids();
    if (running.length > 0) {
      lines.push(`Agent running (PID ${running.join(", ")}) — attempting graceful stop...`);
      const stopResult = await stopAgentProcesses({ graceMs: 5000, excludePid: process.pid });
      lines.push(...stopResult.lines);
      try {
        await unlink(resolveLockPath());
      } catch {
        // absent ok
      }
      await writeStoppedStatus(resolveStatusPath()).catch(() => undefined);

      running = findRunningAgentPids();
      if (running.length > 0) {
        lines.push(`FAIL: Agent still running (PID ${running.join(", ")})`);
        lines.push("Action:");
        lines.push("  1) Run: MJH-Printer-Agent.exe agent:stop");
        lines.push('  2) Or: Stop-Process -Name "MJH-Printer-Agent" -Force (admin)');
        lines.push("  3) Then re-run: config:fix-acl");
        return { exitCode: 2, lines };
      }
      lines.push("Agent stopped — continuing ACL repair");
    }

    const root = getProgramDataRoot();
    const report = await applyProgramDataAcl(root, { forceTakeown: true });
    lines.push(`ProgramData: ${root}`);
    lines.push("");
    lines.push("ACL report:");
    lines.push(`Directory ACL: ${report.directoryAcl}`);
    lines.push(`Config readable: ${report.configReadable}`);
    lines.push(`Data writable: ${report.dataWritable}`);
    lines.push(`Logs readable: ${report.logsReadable}`);
    for (const d of report.details) {
      lines.push(`note: ${d}`);
    }
    const failed =
      report.directoryAcl !== "PASS" ||
      report.configReadable !== "PASS" ||
      report.dataWritable !== "PASS" ||
      report.logsReadable !== "PASS";
    if (failed) {
      lines.push("FAIL");
      return { exitCode: 2, lines };
    }
    lines.push("OK");
    return { exitCode: 0, lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`FAIL: ${message}`);
    lines.push("Action: stop agent manually, then re-run config:fix-acl");
    return { exitCode: 2, lines };
  }
}

export async function runAgentStatus(): Promise<{ exitCode: 0 | 1; lines: string[] }> {
  const lines: string[] = [];
  lines.push("MJH Printer Agent agent:status");
  const status = await readStatusFile(resolveStatusPath());
  if (!status) {
    lines.push("status.json: not present (agent may be stopped)");
    return { exitCode: 1, lines };
  }
  lines.push(`Version: ${status.version}`);
  lines.push(`PID: ${status.pid}`);
  lines.push(`StartedAt: ${status.startedAt}`);
  lines.push(`UpdatedAt: ${status.updatedAt ?? "n/a"}`);
  lines.push(`Cloud: ${status.cloud.online ? "online" : "offline"}`);
  if (status.cloud.lastSuccessAt) lines.push(`Cloud lastSuccessAt: ${status.cloud.lastSuccessAt}`);
  if (status.cloud.lastErrorAt) lines.push(`Cloud lastErrorAt: ${status.cloud.lastErrorAt}`);
  lines.push(
    `Printer: ${status.printer.online ? "online" : "offline"} (${status.printer.ip}:${status.printer.port})`,
  );
  lines.push(`Last poll: ${status.worker.lastPollAt ?? "n/a"}`);
  lines.push(`Last claim: ${status.worker.lastClaimAt ?? "n/a"}`);
  lines.push(`Last print: ${status.worker.lastPrintAt ?? "n/a"}`);
  lines.push(`Last error: ${status.worker.lastError ?? "n/a"}`);
  return { exitCode: 0, lines };
}

export function runLogsPath(): { exitCode: 0; lines: string[] } {
  const logsDir = resolveLogsDir();
  return {
    exitCode: 0,
    lines: ["MJH Printer Agent logs:path", logsDir],
  };
}

export async function runAgentStop(): Promise<{ exitCode: 0 | 1; lines: string[] }> {
  const lines: string[] = [];
  lines.push("MJH Printer Agent agent:stop");

  const result = await stopAgentProcesses({ graceMs: 5000, excludePid: process.pid });
  lines.push(...result.lines);

  try {
    await unlink(resolveLockPath());
    lines.push("Removed agent.lock");
  } catch {
    // absent ok
  }

  try {
    await writeStoppedStatus(resolveStatusPath());
    lines.push("Updated status.json (stopped)");
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    if (code === "EPERM" || code === "EACCES") {
      lines.push("WARN: status.json not writable (run as Administrator to clear status)");
    } else {
      lines.push(
        `WARN: could not update status.json (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  if (result.pids.length > 0 && result.stopped.length + result.forced.length === 0) {
    lines.push("FAIL: could not stop agent");
    lines.push("Fallback: Stop-Process -Name MJH-Printer-Agent -Force (never kill node.exe)");
    return { exitCode: 1, lines };
  }

  const still = findRunningAgentPids().filter((p) => p !== process.pid);
  if (still.length > 0) {
    lines.push(`FAIL: still running PID ${still.join(", ")}`);
    return { exitCode: 1, lines };
  }

  lines.push("OK");
  return { exitCode: 0, lines };
}

export async function runAgentDiagnose(): Promise<{ exitCode: 0 | 1 | 2; lines: string[] }> {
  const lines: string[] = [];
  lines.push("MJH Printer Agent Diagnose");
  lines.push("");
  let exitCode: 0 | 1 | 2 = 0;
  const warnings: string[] = [];

  lines.push(`Version: ${AGENT_VERSION}`);
  lines.push(`Build: ${AGENT_BUILD}`);

  const pids = findRunningAgentPids().filter((p) => p !== process.pid);
  const status = await readStatusFile(resolveStatusPath());
  lines.push("");
  lines.push("Process:");
  if (pids.length === 1) {
    lines.push(`PID: ${pids[0]}`);
    lines.push("Process: PASS");
  } else if (pids.length === 0) {
    lines.push("PID: none");
    lines.push("Process: FAIL (not running)");
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  } else {
    lines.push(`PID: ${pids.join(", ")}`);
    lines.push("Process: FAIL (multiple agents)");
    warnings.push("multiple MJH agent processes");
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  }
  if (status?.startedAt) {
    lines.push(`StartedAt: ${status.startedAt}`);
  }

  lines.push("");
  lines.push("Lock:");
  const lock = await readAgentLock(resolveLockPath());
  if (!lock) {
    lines.push(pids.length === 0 ? "PASS (absent, agent stopped)" : "FAIL (missing while running)");
    if (pids.length > 0) exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  } else if (isPidAlive(lock.pid) && pids.includes(lock.pid)) {
    lines.push(`PASS (pid ${lock.pid})`);
  } else if (!isPidAlive(lock.pid)) {
    lines.push("FAIL (stale lock)");
    warnings.push("stale agent.lock");
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  } else {
    lines.push(`WARN (lock pid ${lock.pid})`);
  }

  lines.push("");
  lines.push("Config:");
  try {
    const file = loadFileConfig(resolveConfigPath());
    if (hasTokenConfigured(file)) {
      lines.push("PASS");
    } else {
      lines.push("FAIL (no token)");
      exitCode = 2;
    }
  } catch (error) {
    lines.push(`FAIL (${error instanceof Error ? error.message : String(error)})`);
    exitCode = 2;
  }

  lines.push("");
  lines.push("ACL:");
  const paths = resolveRuntimePaths();
  const logsRead = await pathReadable(paths.logsDir);
  const dataWrite = await pathWritable(paths.dataDir);
  const aclPass = logsRead && dataWrite;
  lines.push(aclPass ? "PASS" : "FAIL");
  if (!aclPass) {
    warnings.push("ACL: run config:fix-acl (auto-stops agent when possible)");
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  }

  lines.push("");
  lines.push("Cloud:");
  let cloudHealth = false;
  let cloudAuth = false;
  try {
    const file = loadFileConfig(resolveConfigPath());
    const { token } = resolveAgentTokenDetails(file);
    const api = new ApiClient({
      baseUrl: file.cloud.baseUrl,
      token,
      storeId: file.store.id,
      agentId: file.agent.id,
      requestTimeoutMs: 8000,
    });
    await api.health();
    cloudHealth = true;
    lines.push("Health PASS");
    await api.claimJob();
    cloudAuth = true;
    lines.push("Auth PASS");
  } catch (error) {
    if (!cloudHealth) lines.push(`Health FAIL (${cloudErrorDetail(error).message})`);
    else lines.push(`Auth FAIL (${cloudErrorDetail(error).message})`);
    exitCode = Math.max(exitCode, cloudHealth ? 2 : 1) as 0 | 1 | 2;
  }

  lines.push("");
  lines.push("Printer:");
  try {
    const file = loadFileConfig(resolveConfigPath());
    await new PrinterClient(file.printer).testConnection();
    lines.push("TCP PASS");
  } catch (error) {
    lines.push(`TCP FAIL (${error instanceof Error ? error.message : String(error)})`);
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  }

  lines.push("");
  lines.push("Status:");
  if (!status) {
    lines.push("FAIL (missing)");
    exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
  } else {
    const ageMs = status.updatedAt ? Date.now() - Date.parse(status.updatedAt) : Number.POSITIVE_INFINITY;
    const fresh = Number.isFinite(ageMs) && ageMs < 120_000;
    const pidMatch = pids.length === 1 && status.pid === pids[0];
    lines.push(fresh ? "Fresh" : "STALE");
    if (pids.length === 1 && !pidMatch) {
      lines.push(`FAIL (status pid ${status.pid} != process ${pids[0]})`);
      warnings.push("stale status.json pid after restart");
      exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
    }
    lines.push(`cloud.online=${status.cloud.online} doctorAuth=${cloudAuth}`);
    if (cloudAuth && !status.cloud.online) {
      warnings.push("status.json cloud offline while doctor auth PASS");
      exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
    }
    if (!fresh && pids.length > 0) {
      warnings.push("status.json updatedAt is stale");
      exitCode = Math.max(exitCode, 1) as 0 | 1 | 2;
    }
  }

  lines.push("");
  lines.push("Detected Node processes:");
  const procs = listRelevantProcesses();
  if (procs.length === 0) {
    lines.push("(none)");
  } else {
    for (const p of procs) {
      lines.push(
        `  PID ${p.pid} ${p.name} → ${p.isMjhAgent ? "MJH Agent" : "NOT MJH (do not kill)"}`,
      );
    }
  }

  lines.push("");
  lines.push("Warnings:");
  if (warnings.length === 0) lines.push("none");
  else warnings.forEach((w) => lines.push(`- ${w}`));

  return { exitCode, lines };
}
