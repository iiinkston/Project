import { createReadStream, existsSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import {
  hasTokenConfigured,
  loadFileConfig,
  resolveConfigPath,
  resolveLogsDir,
  resolveStatusPath,
} from "../config.js";
import { mergeFileConfig, writeFileConfigAtomic } from "../config-write.js";
import { pairWithCloud } from "../cloud/pair.js";
import { extractApiErrorMessage } from "../cloud/api-error.js";
import { readStatusFile } from "../status.js";
import { AGENT_BUILD, AGENT_VERSION } from "../version.js";
import { runTestPrint } from "../printer/run-test-print.js";
import { logger } from "../logger.js";
import { discoverPrinters9100 } from "./discover.js";
import { handleUpdateApply, handleUpdateCheck } from "./update.js";
import type {
  LocalBindBody,
  LocalBindResponse,
  LocalDiscoverResponse,
  LocalErrorResponse,
  LocalLogsResponse,
  LocalOkResponse,
  LocalPrinterConfigBody,
  LocalStatusResponse,
  LocalUpdateCheckResponse,
} from "./types.js";

const SENSITIVE =
  /(Bearer\s+[A-Za-z0-9+/=._-]+)|("token"\s*:\s*"[^"]*")|(Authorization:\s*\S+)/gi;

export function redactLogLine(line: string): string {
  return line
    .replace(SENSITIVE, (m) => {
      if (/^Bearer/i.test(m)) return "Bearer ***";
      if (/^"token"/i.test(m)) return '"token":"***"';
      if (/^Authorization:/i.test(m)) return "Authorization: ***";
      return "***";
    })
    .replace(/[A-Za-z0-9+/]{20,}={0,2}/g, (m) => {
      if (m.length >= 32) return "***";
      return m;
    });
}

function assertNoSecrets(payload: unknown): void {
  const text = JSON.stringify(payload);
  if (/"token"\s*:/i.test(text) || /"storeId"|"agentId"/i.test(text)) {
    throw new Error("internal: local API response leaked forbidden fields");
  }
}

export async function handleLocalStatus(): Promise<LocalStatusResponse> {
  const file = loadFileConfig(resolveConfigPath());
  const status = await readStatusFile(resolveStatusPath());
  const bound = hasTokenConfigured(file);

  const lastPollAt = status?.worker.lastPollAt ?? null;
  const lastClaimAt = status?.worker.lastClaimAt ?? null;
  const lastSyncAt = lastClaimAt || lastPollAt || status?.updatedAt || null;

  const body: LocalStatusResponse = {
    version: AGENT_VERSION,
    build: AGENT_BUILD,
    running: true,
    pid: status?.pid ?? process.pid,
    startedAt: status?.startedAt ?? null,
    updatedAt: status?.updatedAt ?? null,
    lastSyncAt,
    bound,
    storeName: file.store.name?.trim() || null,
    cloud: {
      online: Boolean(status?.cloud.online),
    },
    printer: {
      model: file.printer.model,
      ip: file.printer.ip,
      port: file.printer.port,
      online: Boolean(status?.printer.online),
    },
    queue: {
      pending: 0,
    },
    worker: {
      lastPollAt,
      lastClaimAt,
      lastPrintAt: status?.worker.lastPrintAt ?? null,
      lastError: status?.worker.lastError ?? null,
    },
  };
  assertNoSecrets(body);
  return body;
}

export function handleLocalUpdateCheck(): LocalUpdateCheckResponse {
  const body = handleUpdateCheck();
  assertNoSecrets(body);
  return body;
}

export function handleLocalUpdate(): LocalOkResponse | LocalErrorResponse {
  const body = handleUpdateApply();
  assertNoSecrets(body);
  return body;
}

export async function handleLocalLogs(limitRaw?: number): Promise<LocalLogsResponse> {
  const limit = Math.min(Math.max(Number(limitRaw) || 100, 1), 1000);
  const logsDir = resolveLogsDir();
  if (!existsSync(logsDir)) {
    return { logs: [] };
  }

  const files = readdirSync(logsDir)
    .filter((n) => /^agent-\d{4}-\d{2}-\d{2}\.log$/.test(n))
    .sort();
  const latest = files[files.length - 1];
  if (!latest) {
    return { logs: [] };
  }

  const path = join(logsDir, latest);
  const lines: string[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    lines.push(redactLogLine(line));
    if (lines.length > limit * 2) {
      lines.splice(0, lines.length - limit);
    }
  }
  const sliced = lines.slice(-limit);
  const body = { logs: sliced };
  assertNoSecrets(body);
  return body;
}

export async function handlePrinterTest(): Promise<LocalOkResponse | LocalErrorResponse> {
  const result = await runTestPrint();
  if (!result.ok) {
    return { ok: false, error: result.message };
  }
  return { ok: true, message: result.message };
}

export async function handlePrinterDiscover(): Promise<LocalDiscoverResponse> {
  return discoverPrinters9100();
}

export async function handlePrinterConfig(
  body: LocalPrinterConfigBody,
): Promise<LocalOkResponse | LocalErrorResponse> {
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    return { ok: false, error: "Invalid ip" };
  }
  const port =
    body.port === undefined ? 9100 : Number.isInteger(body.port) ? body.port : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: "Invalid port" };
  }

  const configPath = resolveConfigPath();
  const base = loadFileConfig(configPath);
  const merged = mergeFileConfig(base, { printerIp: ip, printerPort: port });
  await writeFileConfigAtomic(configPath, merged);
  return { ok: true, message: `Printer endpoint set to ${ip}:${port}` };
}

function resolveBindCode(body: LocalBindBody): string {
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (code) return code;
  return typeof body.pairCode === "string" ? body.pairCode.trim() : "";
}

/**
 * Bind store via Cloud pair API. Token stays in ProgramData only.
 * Rebind with the same long-lived code overwrites store/agent/token.
 */
export async function handleLocalBind(
  body: LocalBindBody,
): Promise<LocalBindResponse | LocalErrorResponse> {
  const code = resolveBindCode(body);
  if (!code || code.length < 4) {
    return { ok: false, error: "请输入有效的门店注册码" };
  }

  const configPath = resolveConfigPath();
  const base = loadFileConfig(configPath);

  try {
    const paired = await pairWithCloud({
      baseUrl: base.cloud.baseUrl,
      pairCode: code,
    });

    const merged = mergeFileConfig(base, {
      storeId: paired.storeId,
      storeName: paired.storeName,
      agentId: paired.agentId,
      token: paired.token,
    });
    await writeFileConfigAtomic(configPath, merged);

    logger.info(
      `[LocalAPI] bind ok store=${paired.storeName} agent=${paired.agentName}`,
      "LOCAL",
    );

    const response: LocalBindResponse = {
      success: true,
      storeName: paired.storeName,
      agentName: paired.agentName,
    };
    assertNoSecrets(response);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : extractApiErrorMessage(error);
    const status =
      typeof error === "object" && error && "status" in error
        ? Number((error as { status: number }).status)
        : 0;
    const safe = message.replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"***"');
    logger.warn(`[LocalAPI] bind failed status=${status || "?"} msg=${safe}`, "LOCAL");
    return { ok: false, error: safe || "绑定失败" };
  }
}

export function parseJsonBody<T>(raw: string): T {
  if (!raw.trim()) {
    throw new Error("Empty JSON body");
  }
  return JSON.parse(raw) as T;
}
