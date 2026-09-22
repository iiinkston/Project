/**
 * Bootstrap OTA regression: simulate store on Client 1.0.5 / Agent 2.4.5
 * consuming a nested Cloud manifest for Client 1.0.6 / Agent 2.4.6.
 *
 * Does not change Cloud API / pairing / DB / print worker.
 * Run: pnpm exec tsx scripts/ota-bootstrap-regression-v105.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentRoot = join(__dirname, "..");
const require = createRequire(import.meta.url);
const {
  parseClientManifest,
  downloadVerifiedFile,
  loadOtaConfig,
  normalizeSha256,
} = require(join(agentRoot, "../mjh-printer-client/electron/client-update-lib.cjs"));

const { handleOtaUpdateCheck, handleOtaUpdateDownload, handleOtaUpdateStatus } = await import(
  "../src/update/ota-service.js"
);

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const results: Record<string, string> = {};
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-boot-"));
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  const prevCfg = process.env.MJH_UPDATE_CONFIG_PATH;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "updates"), { recursive: true });

  // --- Client nested manifest parse (1.0.6) ---
  const clientPayload = Buffer.from("fake-setup-1.0.6-bytes");
  const clientHash = sha256Hex(clientPayload);

  const staging = join(dir, "zip-src");
  mkdirSync(staging, { recursive: true });
  const fakeExe = join(staging, "MJH-Printer-Agent.exe");
  const agentPayload = Buffer.from("fake-agent-2.4.6-exe");
  writeFileSync(fakeExe, agentPayload);
  const zipPath = join(dir, "agent-2.4.6.zip");
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -LiteralPath '${fakeExe.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ],
    { windowsHide: true },
  );
  const zipBytes = await readFile(zipPath);
  const agentHash = sha256Hex(zipBytes);

  let port = 0;
  const cloud = createServer((req, res) => {
    if (req.url === "/manifest") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          client: {
            version: "1.0.6",
            url: `http://127.0.0.1:${port}/MJH-Printer-Setup.exe`,
            sha256: clientHash,
          },
          agent: {
            version: "2.4.6",
            url: `http://127.0.0.1:${port}/MJH-Printer-Agent-v2.4.6.zip`,
            sha256: agentHash,
          },
        }),
      );
      return;
    }
    if (req.url === "/MJH-Printer-Setup.exe") {
      res.writeHead(200);
      res.end(clientPayload);
      return;
    }
    if (req.url === "/MJH-Printer-Agent-v2.4.6.zip") {
      res.writeHead(200, { "Content-Type": "application/zip" });
      res.end(zipBytes);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  port = addr.port;

  try {
    // 1. Manifest parse (Client)
    const nested = parseClientManifest({
      client: {
        version: "1.0.6",
        url: `http://127.0.0.1:${port}/MJH-Printer-Setup.exe`,
        sha256: clientHash,
      },
    });
    assert.equal(nested.clientVersion, "1.0.6");
    results.manifest = "PASS";

    // BOM config
    const cfgPath = join(dir, "config", "update.json");
    process.env.MJH_UPDATE_CONFIG_PATH = cfgPath;
    await writeFile(
      cfgPath,
      `\uFEFF${JSON.stringify({
        enabled: true,
        channel: "stable",
        manifestUrl: `http://127.0.0.1:${port}/manifest`,
        checkIntervalMinutes: 60,
      })}`,
      "utf8",
    );
    const cfg = loadOtaConfig(cfgPath);
    assert.equal(cfg.enabled, true);
    results.configBom = "PASS";

    // 2. Client OTA: download + sha256
    const setupDest = join(dir, "client-updates", "MJH Printer Setup.exe");
    mkdirSync(dirname(setupDest), { recursive: true });
    const dlClient = await downloadVerifiedFile(
      `http://127.0.0.1:${port}/MJH-Printer-Setup.exe`,
      setupDest,
      clientHash,
    );
    assert.equal(dlClient.sha256, clientHash);
    assert.equal(existsSync(setupDest), true);
    results.clientDownloadSha = "PASS";
    results.clientInstallRestart = "SIMULATED_SKIP (needs Setup.exe Apply on store PC)";

    // 3. Agent OTA: check + zip download extract
    const check = await handleOtaUpdateCheck();
    assert.equal(check.updateAvailable, true);
    assert.equal(check.latestVersion, "2.4.6");
    results.agentCheck = "PASS";

    const dl = await handleOtaUpdateDownload();
    assert.equal(dl.ok, true);
    const staged = join(dir, "updates", "MJH-Printer-Agent.exe");
    assert.equal(existsSync(staged), true);
    assert.equal(sha256Hex(await readFile(staged)), sha256Hex(agentPayload));
    results.agentZipExtract = "PASS";
    results.agentReplaceRestart = "SIMULATED_SKIP (update-agent.ps1 Apply on store PC)";

    const status = handleOtaUpdateStatus();
    assert.equal(status.ready, true);
    results.agentReady = "PASS";

    // 4. Live binding flags (optional)
    try {
      const res = await fetch("http://127.0.0.1:17890/local/status", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          bound?: boolean;
          cloud?: { online?: boolean };
          printer?: { online?: boolean };
        };
        results.bound = String(Boolean(body.bound));
        results.cloudOnline = String(Boolean(body.cloud?.online));
        results.printerOnline = String(Boolean(body.printer?.online));
        results.liveStatus = "PASS_READ";
      } else {
        results.liveStatus = `HTTP_${res.status}`;
      }
    } catch {
      results.liveStatus = "AGENT_NOT_RUNNING";
      results.bound = "N/A";
      results.cloudOnline = "N/A";
      results.printerOnline = "N/A";
    }

    results.printPipeline = "PENDING (not executed — out of OTA release scope)";
    results.normalizeSha = normalizeSha256("SHA256:Ab") === "ab" ? "PASS" : "FAIL";

    console.log(JSON.stringify({ ok: true, results }, null, 2));
  } finally {
    cloud.close();
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    if (prevCfg === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
    else process.env.MJH_UPDATE_CONFIG_PATH = prevCfg;
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
