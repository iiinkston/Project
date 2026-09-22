import { logger } from "../logger.js";
import { loadOtaConfig, isOtaRemoteEnabled } from "./ota-config.js";
import { parseRemoteAgentManifest } from "./ota-manifest-normalize.js";
import type { RemoteUpdateManifest } from "./ota-types.js";
import { stripBom } from "./json-bom.js";

export async function fetchRemoteUpdateManifest(options?: {
  manifestUrl?: string;
  requestTimeoutMs?: number;
}): Promise<RemoteUpdateManifest | null> {
  const config = loadOtaConfig();
  const url = (options?.manifestUrl ?? config.manifestUrl).trim();
  if (!isOtaRemoteEnabled(config) && !options?.manifestUrl) {
    return null;
  }
  if (!url) {
    return null;
  }

  logger.info(`OTA CHECK remote manifest url=${url}`, "OTA");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.requestTimeoutMs ?? 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`manifest HTTP ${response.status}: ${text.slice(0, 180)}`);
    }
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(stripBom(text)) : undefined;
    } catch {
      throw new Error("manifest returned non-JSON");
    }
    return parseRemoteAgentManifest(parsed);
  } finally {
    clearTimeout(timer);
  }
}
