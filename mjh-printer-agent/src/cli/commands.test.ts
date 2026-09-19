import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigCheck, runConfigShow, runVersion } from "./commands.js";
import { hashTokenSha256 } from "../config.js";

test("config:check masks token and reports hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-cfg-check-"));
  const cfgPath = join(dir, "printer.json");
  const prev = process.env.MJH_CONFIG_PATH;
  await writeFile(
    cfgPath,
    JSON.stringify(
      {
        store: { id: "store-check" },
        agent: { id: "kitchen-1", token: "sample-token-not-the-live-one", pollIntervalMs: 3000 },
        printer: {
          name: "Kitchen",
          model: "XP-N160II",
          ip: "192.168.0.110",
          port: 9100,
          encoding: "gb18030",
          connectTimeoutMs: 3000,
        },
        cloud: { baseUrl: "http://127.0.0.1:9/api/v1" },
      },
      null,
      2,
    ),
    "utf8",
  );
  process.env.MJH_CONFIG_PATH = cfgPath;
  try {
    const result = runConfigCheck();
    const text = result.lines.join("\n");
    assert.ok(text.includes("Token:"));
    assert.ok(text.includes("Token hash:"));
    assert.ok(text.includes("Token length:"));
    assert.ok(text.includes("Cloud:"));
    assert.ok(text.includes("Agent:"));
    assert.equal(text.includes("sample-token-not-the-live-one"), false);
    assert.equal(/Token exists: YES|NO/.test(text), true);

    const hashLine = result.lines.find((l) => l.startsWith("Token hash: "));
    assert.ok(hashLine);
    const hash = hashLine.replace("Token hash: ", "").trim();
    assert.equal(hash, hashTokenSha256("sample-token-not-the-live-one"));
  } finally {
    if (prev === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("hashTokenSha256 is stable SHA-256 hex", () => {
  const token = "sample-token-value";
  const expected = createHash("sha256").update(token, "utf8").digest("hex");
  assert.equal(hashTokenSha256(token), expected);
});

test("version output has no token", () => {
  const lines = runVersion();
  const text = lines.join("\n");
  assert.ok(text.includes("MJH Printer Agent"));
  assert.ok(text.includes("Version:"));
  assert.equal(text.toLowerCase().includes("token"), false);
});

test("config:show never prints token", () => {
  const result = runConfigShow();
  const text = result.lines.join("\n");
  assert.ok(text.includes("Store:"));
  assert.ok(text.includes("Agent:"));
  assert.ok(text.includes("Cloud:"));
  assert.ok(text.includes("Printer:"));
  assert.equal(text.includes("L7KP6AZ3"), false);
});
