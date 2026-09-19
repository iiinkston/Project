import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { runConfigCheck, runConfigShow, runVersion } from "./commands.js";
import { hashTokenSha256 } from "../config.js";

test("config:check masks token and reports hash", () => {
  const result = runConfigCheck();
  const text = result.lines.join("\n");
  assert.ok(text.includes("Token:"));
  assert.ok(text.includes("Token hash:"));
  assert.ok(text.includes("Token length:"));
  assert.ok(text.includes("Cloud:"));
  assert.ok(text.includes("Agent:"));
  assert.equal(text.includes("L7KP6AZ3"), false);
  assert.equal(/Token exists: YES|NO/.test(text), true);

  const hashLine = result.lines.find((l) => l.startsWith("Token hash: "));
  if (hashLine) {
    const hash = hashLine.replace("Token hash: ", "").trim();
    assert.equal(hash.length, 64);
    assert.equal(/^[a-f0-9]+$/.test(hash), true);
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
