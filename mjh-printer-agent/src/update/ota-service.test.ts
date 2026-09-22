import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeSha256, findStagedAgentExe, extractAgentExeFromZip } from "./ota-download.js";
import {
  handleOtaUpdateCheck,
  handleOtaUpdateDownload,
  handleOtaUpdateStatus,
} from "./ota-service.js";
import { compareVersions } from "../local/update.js";
import { parseRemoteAgentManifest } from "./ota-manifest-normalize.js";
import { loadOtaConfig } from "./ota-config.js";
import { stripBom } from "./json-bom.js";

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

test("normalizeSha256 strips prefix and case", () => {
  assert.equal(normalizeSha256("SHA256:AbCd"), "abcd");
  assert.equal(normalizeSha256("  FF00  "), "ff00");
});

test("parseRemoteAgentManifest accepts nested agent Cloud schema", () => {
  const m = parseRemoteAgentManifest({
    client: { version: "1.0.4", url: "https://example.com/c.exe", sha256: "a".repeat(64) },
    agent: {
      version: "2.4.4",
      url: "https://example.com/MJH-Printer-Agent-v2.4.4.zip",
      sha256: "b".repeat(64),
    },
  });
  assert.equal(m.agentVersion, "2.4.4");
  assert.equal(m.agentUrl, "https://example.com/MJH-Printer-Agent-v2.4.4.zip");
  assert.equal(m.sha256, "b".repeat(64));
});

test("parseRemoteAgentManifest accepts flat agentVersion schema", () => {
  const m = parseRemoteAgentManifest({
    agentVersion: "2.4.3",
    agentUrl: "https://example.com/MJH-Printer-Agent.exe",
    sha256: "c".repeat(64),
  });
  assert.equal(m.agentVersion, "2.4.3");
});

test("stripBom + loadOtaConfig UTF-8 with/without BOM", async () => {
  assert.equal(stripBom("\uFEFF{\"a\":1}"), "{\"a\":1}");
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-bom-"));
  const prev = process.env.MJH_UPDATE_CONFIG_PATH;
  try {
    const noBom = join(dir, "no-bom.json");
    await writeFile(
      noBom,
      JSON.stringify({
        enabled: true,
        channel: "stable",
        manifestUrl: "http://127.0.0.1/m",
        checkIntervalMinutes: 60,
      }),
      "utf8",
    );
    process.env.MJH_UPDATE_CONFIG_PATH = noBom;
    assert.equal(loadOtaConfig().enabled, true);

    const withBom = join(dir, "bom.json");
    await writeFile(
      withBom,
      `\uFEFF${JSON.stringify({
        enabled: true,
        channel: "stable",
        manifestUrl: "http://127.0.0.1/bom",
        checkIntervalMinutes: 120,
      })}`,
      "utf8",
    );
    process.env.MJH_UPDATE_CONFIG_PATH = withBom;
    const cfg = loadOtaConfig();
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.manifestUrl, "http://127.0.0.1/bom");
  } finally {
    if (prev === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
    else process.env.MJH_UPDATE_CONFIG_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("extractAgentExeFromZip finds nested EXE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-zip-"));
  try {
    const staging = join(dir, "staging");
    mkdirSync(staging, { recursive: true });
    const fakeExe = join(staging, "MJH-Printer-Agent.exe");
    writeFileSync(fakeExe, Buffer.from("fake-agent-binary-for-zip-test"));
    const zipPath = join(dir, "agent.zip");
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
    const outExe = join(dir, "out", "MJH-Printer-Agent.exe");
    extractAgentExeFromZip(zipPath, outExe);
    assert.equal(existsSync(outExe), true);
    assert.equal(await readFile(outExe, "utf8"), "fake-agent-binary-for-zip-test");
    assert.equal(findStagedAgentExe(staging), fakeExe);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("OTA remote check + download + sha256 verify stages EXE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-"));
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  const prevUpdateCfg = process.env.MJH_UPDATE_CONFIG_PATH;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "updates"), { recursive: true });

  const payload = Buffer.from("fake-agent-exe-bytes-for-ota-test");
  const hash = sha256Hex(payload);
  let listenPort = 0;

  const cloud = createServer((req, res) => {
    if (req.url === "/manifest" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          channel: "stable",
          agentVersion: "9.9.9",
          agentUrl: `http://127.0.0.1:${listenPort}/agent.exe`,
          sha256: hash,
          releaseNotes: "OTA test build",
          mandatory: false,
        }),
      );
      return;
    }
    if (req.url === "/agent.exe" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end("missing");
  });

  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  listenPort = addr.port;

  const updateCfg = join(dir, "config", "update.json");
  process.env.MJH_UPDATE_CONFIG_PATH = updateCfg;
  await writeFile(
    updateCfg,
    JSON.stringify(
      {
        enabled: true,
        channel: "stable",
        manifestUrl: `http://127.0.0.1:${addr.port}/manifest`,
        checkIntervalMinutes: 360,
      },
      null,
      2,
    ),
    "utf8",
  );

  try {
    assert.equal(compareVersions("9.9.9", "2.4.2"), 1);

    const check = await handleOtaUpdateCheck();
    assert.equal(check.updateAvailable, true);
    assert.equal(check.latestVersion, "9.9.9");
    assert.equal(check.notes, "OTA test build");

    const before = handleOtaUpdateStatus();
    assert.equal(before.remoteEnabled, true);
    assert.equal(before.downloaded, false);

    const dl = await handleOtaUpdateDownload();
    assert.equal(dl.ok, true);

    const staged = join(dir, "updates", "MJH-Printer-Agent.exe");
    assert.equal(existsSync(staged), true);
    const bytes = await readFile(staged);
    assert.equal(sha256Hex(bytes), hash);
    assert.equal(existsSync(join(dir, "updates", "MJH-Printer-Agent.exe.partial")), false);

    const manifest = JSON.parse(await readFile(join(dir, "updates", "manifest.json"), "utf8")) as {
      latestVersion: string;
      sha256: string;
    };
    assert.equal(manifest.latestVersion, "9.9.9");
    assert.equal(normalizeSha256(manifest.sha256), hash);

    const status = handleOtaUpdateStatus();
    assert.equal(status.ready, true);
    assert.equal(status.downloaded, true);
    assert.equal(status.latestVersion, "9.9.9");
  } finally {
    cloud.close();
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    if (prevUpdateCfg === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
    else process.env.MJH_UPDATE_CONFIG_PATH = prevUpdateCfg;
    await rm(dir, { recursive: true, force: true });
  }
});

test("OTA nested manifest + zip download extract stages EXE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-zipdl-"));
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  const prevUpdateCfg = process.env.MJH_UPDATE_CONFIG_PATH;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "updates"), { recursive: true });

  const payload = Buffer.from("zip-packaged-agent-exe-bytes");
  const staging = join(dir, "zip-src");
  mkdirSync(staging, { recursive: true });
  const fakeExe = join(staging, "MJH-Printer-Agent.exe");
  writeFileSync(fakeExe, payload);
  const zipPath = join(dir, "agent-pkg.zip");
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
  const zipHash = sha256Hex(zipBytes);
  let listenPort = 0;

  const cloud = createServer((req, res) => {
    if (req.url === "/manifest") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          client: { version: "1.0.4", url: "https://example.com/c.exe", sha256: "a".repeat(64) },
          agent: {
            version: "9.9.7",
            url: `http://127.0.0.1:${listenPort}/MJH-Printer-Agent-v9.9.7.zip`,
            sha256: zipHash,
          },
        }),
      );
      return;
    }
    if (req.url === "/MJH-Printer-Agent-v9.9.7.zip") {
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
  listenPort = addr.port;

  const updateCfg = join(dir, "config", "update.json");
  process.env.MJH_UPDATE_CONFIG_PATH = updateCfg;
  await writeFile(
    updateCfg,
    `\uFEFF${JSON.stringify({
      enabled: true,
      channel: "stable",
      manifestUrl: `http://127.0.0.1:${listenPort}/manifest`,
      checkIntervalMinutes: 60,
    })}`,
    "utf8",
  );

  try {
    const check = await handleOtaUpdateCheck();
    assert.equal(check.updateAvailable, true);
    assert.equal(check.latestVersion, "9.9.7");

    const dl = await handleOtaUpdateDownload();
    assert.equal(dl.ok, true);

    const staged = join(dir, "updates", "MJH-Printer-Agent.exe");
    assert.equal(existsSync(staged), true);
    assert.equal(sha256Hex(await readFile(staged)), sha256Hex(payload));
    assert.equal(existsSync(join(dir, "updates", "MJH-Printer-Agent.zip")), false);

    const status = handleOtaUpdateStatus();
    assert.equal(status.ready, true);
  } finally {
    cloud.close();
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    if (prevUpdateCfg === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
    else process.env.MJH_UPDATE_CONFIG_PATH = prevUpdateCfg;
    await rm(dir, { recursive: true, force: true });
  }
});

test("OTA download rejects SHA256 mismatch and removes partial", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-badhash-"));
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  const prevUpdateCfg = process.env.MJH_UPDATE_CONFIG_PATH;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "updates"), { recursive: true });

  const payload = Buffer.from("wrong-bytes");
  let addrPort = 0;
  const cloud = createServer((req, res) => {
    if (req.url === "/manifest") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          agentVersion: "9.9.8",
          agentUrl: `http://127.0.0.1:${addrPort}/agent.exe`,
          sha256: "0".repeat(64),
        }),
      );
      return;
    }
    if (req.url === "/agent.exe") {
      res.writeHead(200);
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  addrPort = addr.port;

  const updateCfg = join(dir, "config", "update.json");
  process.env.MJH_UPDATE_CONFIG_PATH = updateCfg;
  await writeFile(
    updateCfg,
    JSON.stringify({
      enabled: true,
      channel: "stable",
      manifestUrl: `http://127.0.0.1:${addrPort}/manifest`,
      checkIntervalMinutes: 60,
    }),
    "utf8",
  );

  try {
    const dl = await handleOtaUpdateDownload();
    assert.equal(dl.ok, false);
    if ("error" in dl) {
      assert.match(dl.error, /SHA256/i);
    }
    assert.equal(existsSync(join(dir, "updates", "MJH-Printer-Agent.exe")), false);
    assert.equal(existsSync(join(dir, "updates", "MJH-Printer-Agent.exe.partial")), false);
  } finally {
    cloud.close();
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    if (prevUpdateCfg === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
    else process.env.MJH_UPDATE_CONFIG_PATH = prevUpdateCfg;
    await rm(dir, { recursive: true, force: true });
  }
});

test("OTA disabled keeps local-only check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-ota-off-"));
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  const prevUpdateCfg = process.env.MJH_UPDATE_CONFIG_PATH;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  const updateCfg = join(dir, "config", "update.json");
  process.env.MJH_UPDATE_CONFIG_PATH = updateCfg;
  await writeFile(
    updateCfg,
    JSON.stringify({
      enabled: false,
      channel: "stable",
      manifestUrl: "http://127.0.0.1:9/nope",
      checkIntervalMinutes: 360,
    }),
    "utf8",
  );

  try {
    const check = await handleOtaUpdateCheck();
    assert.equal(typeof check.currentVersion, "string");
    const status = handleOtaUpdateStatus();
    assert.equal(status.remoteEnabled, false);
  } finally {
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    if (prevUpdateCfg === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
    else process.env.MJH_UPDATE_CONFIG_PATH = prevUpdateCfg;
    await rm(dir, { recursive: true, force: true });
  }
});
