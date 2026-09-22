"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");
const { mkdtemp, mkdir, readFile, rm, writeFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  compareVersions,
  normalizeSha256,
  parseClientManifest,
  downloadVerifiedFile,
  loadOtaConfig,
  stripBom,
} = require("./client-update-lib.cjs");

test("compareVersions orders semver-ish strings", () => {
  assert.equal(compareVersions("1.0.3", "1.0.2"), 1);
  assert.equal(compareVersions("1.0.1", "1.0.2"), -1);
  assert.equal(compareVersions("1.0.2", "1.0.2"), 0);
});

test("compareVersions rejects downgrade (remote < current → no update)", () => {
  // Production rule: offer update only when remote > current
  const current = "1.0.8";
  const olderRemote = "1.0.7";
  assert.equal(compareVersions(olderRemote, current) <= 0, true);
  assert.equal(compareVersions("1.0.9", current) > 0, true);
});

test("parseClientManifest requires version url sha", () => {
  const m = parseClientManifest({
    clientVersion: "1.0.3",
    clientUrl: "https://cdn.example.com/setup.exe",
    clientSha256: "abcd".repeat(8),
    releaseNotes: "notes",
  });
  assert.equal(m.clientVersion, "1.0.3");
  assert.equal(m.releaseNotes, "notes");
  assert.throws(() => parseClientManifest({ clientVersion: "1.0.3" }), /clientUrl/);
});

test("parseClientManifest accepts nested client.version Cloud schema", () => {
  const m = parseClientManifest({
    client: {
      version: "1.0.4",
      url: "https://cdn.example.com/MJH-Printer-Setup.exe",
      sha256: "b".repeat(64),
    },
    agent: {
      version: "2.4.4",
      url: "https://cdn.example.com/agent.zip",
      sha256: "c".repeat(64),
    },
  });
  assert.equal(m.clientVersion, "1.0.4");
  assert.equal(m.clientUrl, "https://cdn.example.com/MJH-Printer-Setup.exe");
  assert.equal(m.clientSha256, "b".repeat(64));
});

test("normalizeSha256 strips prefix and whitespace", () => {
  assert.equal(normalizeSha256("SHA256:AbCdEf"), "abcdef");
  assert.equal(normalizeSha256(" ab cd "), "abcd");
});

test("stripBom removes UTF-8 BOM", () => {
  assert.equal(stripBom("\uFEFF{\"enabled\":true}"), "{\"enabled\":true}");
  assert.equal(stripBom("{\"enabled\":true}"), "{\"enabled\":true}");
});

test("loadOtaConfig accepts UTF-8 with and without BOM", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-ota-cfg-"));
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
    const cfg1 = loadOtaConfig(noBom);
    assert.equal(cfg1.enabled, true);
    assert.equal(cfg1.manifestUrl, "http://127.0.0.1/m");

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
    const cfg2 = loadOtaConfig(withBom);
    assert.equal(cfg2.enabled, true);
    assert.equal(cfg2.manifestUrl, "http://127.0.0.1/bom");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("downloadVerifiedFile accepts matching sha and rejects mismatch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-ota-"));
  const payload = Buffer.from("client-setup-bytes");
  const hash = createHash("sha256").update(payload).digest("hex");
  let port = 0;

  const server = createServer((req, res) => {
    if (req.url === "/setup.exe") {
      res.writeHead(200);
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  port = addr.port;

  try {
    const okPath = join(dir, "MJH Printer Setup.exe");
    const ok = await downloadVerifiedFile(
      `http://127.0.0.1:${port}/setup.exe`,
      okPath,
      hash,
    );
    assert.equal(existsSync(okPath), true);
    assert.equal(ok.sha256, hash);
    assert.equal(existsSync(`${okPath}.partial`), false);

    const badPath = join(dir, "bad.exe");
    await assert.rejects(
      () =>
        downloadVerifiedFile(`http://127.0.0.1:${port}/setup.exe`, badPath, "0".repeat(64)),
      /SHA256 mismatch/,
    );
    assert.equal(existsSync(badPath), false);
    assert.equal(existsSync(`${badPath}.partial`), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed download removes partial file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-ota-fail-"));
  let port = 0;
  const server = createServer((_req, res) => {
    res.writeHead(500);
    res.end("boom");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  port = addr.port;
  const dest = join(dir, "MJH Printer Setup.exe");
  try {
    await assert.rejects(
      () => downloadVerifiedFile(`http://127.0.0.1:${port}/setup.exe`, dest, "a".repeat(64)),
      /download HTTP 500/,
    );
    assert.equal(existsSync(dest), false);
    assert.equal(existsSync(`${dest}.partial`), false);
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
