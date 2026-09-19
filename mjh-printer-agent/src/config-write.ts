import { copyFile, mkdir, rename, unlink, writeFile, readFile, access, constants as fsConstants, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { FileConfig } from "./config.js";

const execFileAsync = promisify(execFile);

const UTF8_NO_BOM = "utf8";

/** Well-known SIDs — locale-independent on Windows. */
const SID_SYSTEM = "*S-1-5-18";
const SID_ADMINS = "*S-1-5-32-544";
const SID_USERS = "*S-1-5-32-545";

export type ConfigSetPatch = {
  storeId?: string;
  agentId?: string;
  token?: string;
  pollIntervalMs?: number;
  cloudBaseUrl?: string;
  printerIp?: string;
  printerPort?: number;
  printerName?: string;
  printerModel?: string;
  connectTimeoutMs?: number;
};

export type WriteConfigResult = {
  configPath: string;
  backupPath: string | null;
};

export type AclFixReport = {
  directoryAcl: "PASS" | "FAIL";
  configReadable: "PASS" | "FAIL";
  dataWritable: "PASS" | "FAIL";
  logsReadable: "PASS" | "FAIL";
  details: string[];
};

/**
 * Merge patch into existing config. Preserves printer + cloud unless explicitly overridden.
 */
export function mergeFileConfig(base: FileConfig, patch: ConfigSetPatch): FileConfig {
  return {
    store: {
      id: patch.storeId?.trim() || base.store.id,
    },
    agent: {
      id: patch.agentId?.trim() || base.agent.id,
      token: patch.token !== undefined ? patch.token.trim() : base.agent.token,
      pollIntervalMs:
        patch.pollIntervalMs !== undefined ? patch.pollIntervalMs : base.agent.pollIntervalMs,
    },
    printer: {
      name: patch.printerName?.trim() || base.printer.name,
      model: patch.printerModel?.trim() || base.printer.model,
      ip: patch.printerIp?.trim() || base.printer.ip,
      port: patch.printerPort !== undefined ? patch.printerPort : base.printer.port,
      encoding: "gb18030",
      connectTimeoutMs:
        patch.connectTimeoutMs !== undefined
          ? patch.connectTimeoutMs
          : base.printer.connectTimeoutMs,
    },
    cloud: {
      baseUrl: patch.cloudBaseUrl?.trim() || base.cloud.baseUrl,
    },
  };
}

export function serializeFileConfig(config: FileConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Atomic UTF-8 (no BOM) write with backup of previous file.
 */
export async function writeFileConfigAtomic(
  configPath: string,
  config: FileConfig,
): Promise<WriteConfigResult> {
  const dir = dirname(configPath);
  await mkdir(dir, { recursive: true });

  const payload = serializeFileConfig(config);
  const buffer = Buffer.from(payload, UTF8_NO_BOM);
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    throw new Error("internal: refused to write UTF-8 BOM config");
  }

  let backupPath: string | null = null;
  try {
    await readFile(configPath);
    backupPath = `${configPath}.bak`;
    await copyFile(configPath, backupPath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    if (code !== "ENOENT") {
      throw error;
    }
  }

  const tempPath = join(dir, `printer.json.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, buffer);
  try {
    await rename(tempPath, configPath);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : undefined;
    if (code === "EEXIST" || code === "EPERM" || code === "EACCES") {
      await unlink(configPath).catch(() => undefined);
      await rename(tempPath, configPath);
    } else {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }

  return { configPath, backupPath };
}

/**
 * Apply recommended ProgramData ACL recursively (Windows only).
 * Prefer stopping the agent first so log files are not locked.
 * Uses takeown + icacls. Does NOT grant Everyone Full Control.
 */
export async function applyProgramDataAcl(
  programDataRoot: string,
  options?: { forceTakeown?: boolean },
): Promise<AclFixReport> {
  const details: string[] = [];
  const report: AclFixReport = {
    directoryAcl: "FAIL",
    configReadable: "FAIL",
    dataWritable: "FAIL",
    logsReadable: "FAIL",
    details,
  };

  if (process.platform !== "win32") {
    details.push("ACL apply skipped (non-Windows)");
    report.directoryAcl = "PASS";
    report.configReadable = "PASS";
    report.dataWritable = "PASS";
    report.logsReadable = "PASS";
    return report;
  }

  const configDir = join(programDataRoot, "config");
  const dataDir = join(programDataRoot, "data");
  const logsDir = join(programDataRoot, "logs");

  for (const dir of [programDataRoot, configDir, dataDir, logsDir]) {
    await mkdir(dir, { recursive: true });
  }

  if (options?.forceTakeown !== false) {
    try {
      await execFileAsync("takeown", ["/F", programDataRoot, "/R", "/D", "Y"], {
        windowsHide: true,
      });
      details.push("takeown /R completed");
    } catch (error) {
      details.push(
        `takeown warning: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200),
      );
    }
  }

  await runIcacls(programDataRoot, ["/inheritance:r"]);
  await runIcacls(programDataRoot, ["/grant:r", `${SID_SYSTEM}:(OI)(CI)F`]);
  await runIcacls(programDataRoot, ["/grant:r", `${SID_ADMINS}:(OI)(CI)F`]);
  await runIcacls(programDataRoot, ["/grant:r", `${SID_USERS}:(OI)(CI)RX`]);

  await runIcacls(programDataRoot, ["/grant:r", `${SID_SYSTEM}:(OI)(CI)F`, "/T", "/C"]);
  await runIcacls(programDataRoot, ["/grant:r", `${SID_ADMINS}:(OI)(CI)F`, "/T", "/C"]);
  await runIcacls(programDataRoot, ["/grant:r", `${SID_USERS}:(OI)(CI)RX`, "/T", "/C"]);

  const knownFiles = [
    join(configDir, "printer.json"),
    join(configDir, "printer.json.bak"),
    join(dataDir, "status.json"),
    join(dataDir, "print-state.json"),
    join(dataDir, "agent.lock"),
  ];
  for (const file of knownFiles) {
    try {
      await access(file, fsConstants.F_OK);
      await runIcacls(file, ["/grant:r", `${SID_SYSTEM}:F`, "/C"]);
      await runIcacls(file, ["/grant:r", `${SID_ADMINS}:F`, "/C"]);
      await runIcacls(file, ["/grant:r", `${SID_USERS}:RX`, "/C"]);
    } catch {
      // optional
    }
  }

  try {
    const entries = await readdir(logsDir);
    for (const name of entries) {
      if (!name.endsWith(".log") && !name.endsWith(".tmp")) continue;
      const file = join(logsDir, name);
      try {
        await execFileAsync("takeown", ["/F", file], { windowsHide: true });
      } catch {
        // continue
      }
      await runIcacls(file, ["/grant:r", `${SID_SYSTEM}:F`, "/C"]);
      await runIcacls(file, ["/grant:r", `${SID_ADMINS}:F`, "/C"]);
      await runIcacls(file, ["/grant:r", `${SID_USERS}:RX`, "/C"]);
    }
  } catch {
    // empty logs dir ok
  }

  details.push("Applied SYSTEM+Administrators Full, Users RX recursively");

  try {
    await access(programDataRoot, fsConstants.R_OK);
    report.directoryAcl = "PASS";
  } catch {
    details.push("Directory ACL verify failed");
  }

  const configPath = join(configDir, "printer.json");
  try {
    await access(configPath, fsConstants.R_OK);
    report.configReadable = "PASS";
  } catch {
    try {
      await access(configDir, fsConstants.R_OK);
      report.configReadable = "PASS";
      details.push("Config file absent; config dir readable");
    } catch {
      details.push("Config not readable");
    }
  }

  const probe = join(dataDir, `.acl-write-probe-${process.pid}`);
  try {
    await writeFile(probe, "ok", "utf8");
    await unlink(probe);
    report.dataWritable = "PASS";
  } catch {
    details.push("Data dir not writable");
    await unlink(probe).catch(() => undefined);
  }

  try {
    await access(logsDir, fsConstants.R_OK);
    const logs = await readdir(logsDir);
    const sample = logs.find((n) => n.endsWith(".log"));
    if (sample) {
      await readFile(join(logsDir, sample), { encoding: "utf8", flag: "r" });
    }
    report.logsReadable = "PASS";
  } catch (error) {
    details.push(
      `Logs not readable: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160),
    );
  }

  return report;
}

async function runIcacls(target: string, args: string[]): Promise<void> {
  try {
    await execFileAsync("icacls", [target, ...args], { windowsHide: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to set ACL on ${target}: ${detail}`);
  }
}

export function parseConfigSetArgs(argv: string[]): ConfigSetPatch {
  const patch: ConfigSetPatch = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    const take = (): string => {
      if (!next || next.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return next;
    };

    switch (arg) {
      case "--store-id":
        patch.storeId = take();
        break;
      case "--agent-id":
        patch.agentId = take();
        break;
      case "--token":
        patch.token = take();
        break;
      case "--poll-interval-ms":
        patch.pollIntervalMs = Number(take());
        break;
      case "--cloud-base-url":
        patch.cloudBaseUrl = take();
        break;
      case "--printer-ip":
        patch.printerIp = take();
        break;
      case "--printer-port":
        patch.printerPort = Number(take());
        break;
      case "--printer-name":
        patch.printerName = take();
        break;
      case "--printer-model":
        patch.printerModel = take();
        break;
      case "--connect-timeout-ms":
        patch.connectTimeoutMs = Number(take());
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        break;
    }
  }

  if (
    patch.pollIntervalMs !== undefined &&
    (!Number.isInteger(patch.pollIntervalMs) || patch.pollIntervalMs <= 0)
  ) {
    throw new Error("--poll-interval-ms must be a positive integer");
  }
  if (
    patch.printerPort !== undefined &&
    (!Number.isInteger(patch.printerPort) || patch.printerPort < 1 || patch.printerPort > 65535)
  ) {
    throw new Error("--printer-port must be 1..65535");
  }
  if (
    patch.connectTimeoutMs !== undefined &&
    (!Number.isInteger(patch.connectTimeoutMs) || patch.connectTimeoutMs <= 0)
  ) {
    throw new Error("--connect-timeout-ms must be a positive integer");
  }

  return patch;
}
