import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { logger } from "../logger.js";
import { resolveUpdatesDir, type UpdateManifest } from "../local/update.js";
import type { RemoteUpdateManifest } from "./ota-types.js";

const EXE_NAME = "MJH-Printer-Agent.exe";
const ZIP_NAME = "MJH-Printer-Agent.zip";

export function normalizeSha256(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^sha256:/i, "")
    .replace(/\s+/g, "");
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

function looksLikeZip(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pathname.endsWith(".zip");
  } catch {
    return /\.zip(\?|#|$)/i.test(url);
  }
}

/** Recursively locate MJH-Printer-Agent.exe under extractDir. */
export function findStagedAgentExe(extractDir: string): string | null {
  const stack = [extractDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
      } else if (name.toLowerCase() === EXE_NAME.toLowerCase()) {
        return full;
      }
    }
  }
  return null;
}

/**
 * Extract zip and copy MJH-Printer-Agent.exe to destExePath.
 * Uses PowerShell Expand-Archive (Windows storefront).
 */
export function extractAgentExeFromZip(zipPath: string, destExePath: string): void {
  const extractDir = join(dirname(zipPath), `.extract-${Date.now()}`);
  mkdirSync(extractDir, { recursive: true });
  try {
    const zipLit = zipPath.replace(/'/g, "''");
    const destLit = extractDir.replace(/'/g, "''");
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Expand-Archive -LiteralPath '${zipLit}' -DestinationPath '${destLit}' -Force`,
      ],
      { windowsHide: true, timeout: 120_000 },
    );
    const found = findStagedAgentExe(extractDir);
    if (!found) {
      throw new Error("zip missing MJH-Printer-Agent.exe");
    }
    mkdirSync(dirname(destExePath), { recursive: true });
    if (existsSync(destExePath)) {
      try {
        unlinkSync(destExePath);
      } catch {
        // ignore
      }
    }
    copyFileSync(found, destExePath);
  } finally {
    try {
      rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Download remote package (EXE or ZIP) into ProgramData updates\,
 * verify SHA256 of the downloaded package, stage MJH-Printer-Agent.exe,
 * write local manifest.json. Incomplete downloads are removed.
 *
 * Apply still uses update-agent.ps1 -Source EXE (unchanged).
 */
export async function downloadAndStageUpdate(
  remote: RemoteUpdateManifest,
  options?: { requestTimeoutMs?: number },
): Promise<DownloadResult> {
  const updatesDir = resolveUpdatesDir();
  mkdirSync(updatesDir, { recursive: true });

  const finalExePath = join(updatesDir, EXE_NAME);
  const isZip = looksLikeZip(remote.agentUrl);
  const packageName = isZip ? ZIP_NAME : EXE_NAME;
  const finalPackagePath = join(updatesDir, packageName);
  const partialPath = join(updatesDir, `${packageName}.partial`);
  const expected = normalizeSha256(remote.sha256);

  logger.info(
    `OTA DOWNLOAD START version=${remote.agentVersion} url=${remote.agentUrl} package=${packageName}`,
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

    if (existsSync(finalPackagePath)) {
      try {
        unlinkSync(finalPackagePath);
      } catch {
        // ignore
      }
    }
    renameSync(partialPath, finalPackagePath);

    if (isZip) {
      logger.info("OTA EXTRACT zip → MJH-Printer-Agent.exe", "OTA");
      extractAgentExeFromZip(finalPackagePath, finalExePath);
      try {
        unlinkSync(finalPackagePath);
      } catch {
        // keep zip if delete fails; EXE is what apply needs
      }
    } else if (finalPackagePath !== finalExePath) {
      if (existsSync(finalExePath)) {
        try {
          unlinkSync(finalExePath);
        } catch {
          // ignore
        }
      }
      renameSync(finalPackagePath, finalExePath);
    }

    if (!existsSync(finalExePath)) {
      throw new Error("staged MJH-Printer-Agent.exe missing after download");
    }

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
      exePath: finalExePath,
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
