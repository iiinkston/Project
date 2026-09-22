"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const { createWriteStream, createReadStream } = require("node:fs");
const { Readable } = require("node:stream");

const SETUP_NAME = "MJH Printer Setup.exe";

function compareVersions(a, b) {
  const pa = String(a)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10) || 0);
  const pb = String(b)
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => Number.parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function normalizeSha256(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/i, "");
}

function parseClientManifest(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid client manifest");
  }
  const clientVersion = String(raw.clientVersion || "").trim();
  const clientUrl = String(raw.clientUrl || "").trim();
  const clientSha256 = normalizeSha256(raw.clientSha256 || "");
  if (!clientVersion) throw new Error("manifest missing clientVersion");
  if (!clientUrl) throw new Error("manifest missing clientUrl");
  if (clientSha256.length < 16) throw new Error("manifest missing clientSha256");
  return {
    clientVersion,
    clientUrl,
    clientSha256,
    releaseNotes:
      typeof raw.releaseNotes === "string" ? raw.releaseNotes.trim() : null,
  };
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function defaultOtaConfig() {
  return {
    enabled: false,
    channel: "stable",
    manifestUrl: "",
    checkIntervalMinutes: 360,
  };
}

function loadOtaConfig(configPath) {
  try {
    if (!configPath || !fs.existsSync(configPath)) return defaultOtaConfig();
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      enabled: Boolean(raw.enabled),
      channel: String(raw.channel || "stable"),
      manifestUrl: String(raw.manifestUrl || "").trim(),
      checkIntervalMinutes: Number(raw.checkIntervalMinutes) || 360,
    };
  } catch {
    return defaultOtaConfig();
  }
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Download remote file to destination via temp .partial, verify sha256, rename.
 */
async function downloadVerifiedFile(url, destination, expectedSha256, timeoutMs = 300_000) {
  const expected = normalizeSha256(expectedSha256);
  const partial = `${destination}.partial`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(partial)) {
    try {
      fs.unlinkSync(partial);
    } catch {
      // ignore
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const snippet = (await response.text().catch(() => "")).slice(0, 160);
      throw new Error(`download HTTP ${response.status}: ${snippet}`);
    }
    const nodeStream = Readable.fromWeb(response.body);
    await pipeline(nodeStream, createWriteStream(partial));
    const actual = await sha256File(partial);
    if (actual !== expected) {
      try {
        fs.unlinkSync(partial);
      } catch {
        // ignore
      }
      throw new Error(`SHA256 mismatch expected=${expected} actual=${actual}`);
    }
    if (fs.existsSync(destination)) {
      try {
        fs.unlinkSync(destination);
      } catch {
        // ignore
      }
    }
    fs.renameSync(partial, destination);
    return { path: destination, sha256: actual };
  } catch (error) {
    try {
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    } catch {
      // ignore
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  SETUP_NAME,
  compareVersions,
  normalizeSha256,
  parseClientManifest,
  sha256File,
  defaultOtaConfig,
  loadOtaConfig,
  readJsonSafe,
  writeJson,
  downloadVerifiedFile,
};
