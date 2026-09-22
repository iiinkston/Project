import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { logger } from "../logger.js";
import { resolveUpdatesDir, type UpdateManifest } from "../local/update.js";
import type { RemoteUpdateManifest } from "./ota-types.js";

const EXE_NAME = "MJH-Printer-Agent.exe";

export function normalizeSha256(value: string): string {
  return value.trim().toLowerCase().replace(/^sha256:/i, "");
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

export type DownloadResult = {
  ok: true;
  version: string;
  exePath: string;
  sha256: string;
} | {
  ok: false;
  error: string;
};

/**
 * Download remote EXE into ProgramData updates\, verify SHA256, write local manifest.json.
 * Incomplete downloads are removed.
 */
export async function downloadAndStageUpdate(
  remote: RemoteUpdateManifest,
  options?: { requestTimeoutMs?: number },
): Promise<DownloadResult> {
  const updatesDir = resolveUpdatesDir();
  mkdirSync(updatesDir, { recursive: true });

  const finalPath = join(updatesDir, EXE_NAME);
  const partialPath = join(updatesDir, `${EXE_NAME}.partial`);
  const expected = normalizeSha256(remote.sha256);

  logger.info(
    `OTA DOWNLOAD START version=${remote.agentVersion} url=${remote.agentUrl}`,
    "OTA",
  );

  if (existsSync(partialPath)) {
    try {
      unlinkSync(partialPath);
    } catch {
      // ignore
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.requestTimeoutMs ?? 300_000);

  try {
    const response = await fetch(remote.agentUrl, {
      method: "GET",
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok || !response.body) {
      const snippet = (await response.text().catch(() => "")).slice(0, 160);
      throw new Error(`download HTTP ${response.status}: ${snippet}`);
    }

    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(partialPath));

    const actual = await sha256File(partialPath);
    if (actual !== expected) {
      try {
        unlinkSync(partialPath);
      } catch {
        // ignore
      }
      logger.error(
        `OTA DOWNLOAD FAILED SHA256 mismatch expected=${expected} actual=${actual}`,
        "OTA",
      );
      return { ok: false, error: "SHA256 mismatch — downloaded file rejected" };
    }

    logger.info("SHA256 VERIFIED", "OTA");

    if (existsSync(finalPath)) {
      try {
        unlinkSync(finalPath);
      } catch {
        // ignore
      }
    }
    renameSync(partialPath, finalPath);

    const localManifest: UpdateManifest & { sha256?: string; channel?: string } = {
      latestVersion: remote.agentVersion,
      notes: remote.releaseNotes?.trim() || undefined,
      exePath: EXE_NAME,
      sha256: expected,
      channel: remote.channel,
    };
    writeFileSync(
      join(updatesDir, "manifest.json"),
      `${JSON.stringify(localManifest, null, 2)}\n`,
      "utf8",
    );

    logger.info(`OTA DOWNLOAD SUCCESS version=${remote.agentVersion}`, "OTA");
    logger.info("UPDATE READY", "OTA");
    return {
      ok: true,
      version: remote.agentVersion,
      exePath: finalPath,
      sha256: actual,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      if (existsSync(partialPath)) unlinkSync(partialPath);
    } catch {
      // ignore
    }
    logger.error(`OTA DOWNLOAD FAILED ${message}`, "OTA");
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}
