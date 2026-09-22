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
} = require("./client-update-lib.cjs");

test("compareVersions orders semver-ish strings", () => {
  assert.equal(compareVersions("1.0.3", "1.0.2"), 1);
  assert.equal(compareVersions("1.0.1", "1.0.2"), -1);
  assert.equal(compareVersions("1.0.2", "1.0.2"), 0);
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

test("normalizeSha256 strips prefix", () => {
  assert.equal(normalizeSha256("SHA256:AbCdEf"), "abcdef");
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
