import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, loadFileConfig, resolveAgentToken, TOKEN_ENV } from "./config.js";

async function writeTempConfig(token?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "mjh-cfg-"));
  const path = join(dir, "printer.json");
  const agent: Record<string, unknown> = {
    id: "kitchen-1",
    pollIntervalMs: 3000,
  };
  if (token !== undefined) {
    agent.token = token;
  }

  await writeFile(
    path,
    JSON.stringify({
      store: { id: "store-1" },
      agent,
      printer: {
        name: "Kitchen",
        model: "XP-N160II",
        ip: "127.0.0.1",
        port: 9100,
        encoding: "gb18030",
        connectTimeoutMs: 1000,
      },
      cloud: { baseUrl: "http://127.0.0.1:3001/v1" },
    }),
    "utf8",
  );

  return path;
}

test("config.agent.token is loaded", async () => {
  const path = await writeTempConfig("cfg-token-value");
  try {
    const file = loadFileConfig(path);
    assert.equal(file.agent.token, "cfg-token-value");
    const app = loadConfig(path);
    assert.equal(app.cloud.token, "cfg-token-value");
  } finally {
    await rm(join(path, ".."), { recursive: true, force: true });
  }
});

test("environment token remains a fallback", async () => {
  const path = await writeTempConfig();
  const prev = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = "env-token-value";
  try {
    const file = loadFileConfig(path);
    assert.equal(file.agent.token, undefined);
    assert.equal(resolveAgentToken(file), "env-token-value");
  } finally {
    if (prev === undefined) {
      delete process.env[TOKEN_ENV];
    } else {
      process.env[TOKEN_ENV] = prev;
    }
    await rm(join(path, ".."), { recursive: true, force: true });
  }
});

test("config token takes precedence over environment", async () => {
  const path = await writeTempConfig("cfg-wins");
  const prev = process.env[TOKEN_ENV];
  process.env[TOKEN_ENV] = "env-loses";
  try {
    const file = loadFileConfig(path);
    assert.equal(resolveAgentToken(file), "cfg-wins");
  } finally {
    if (prev === undefined) {
      delete process.env[TOKEN_ENV];
    } else {
      process.env[TOKEN_ENV] = prev;
    }
    await rm(join(path, ".."), { recursive: true, force: true });
  }
});

test("token never appears in startup log lines", async () => {
  const path = await writeTempConfig("super-secret-token-xyz");
  try {
    const app = loadConfig(path);
    const startupLines = [
      `[MJH] Printer Agent starting`,
      `[MJH] Config loaded`,
      `[MJH] PID: ${process.pid}`,
      `[MJH] Version: ${app.version}`,
      `[MJH] Store: ${app.store.id}`,
      `[MJH] Agent: ${app.agent.id}`,
      `[MJH] Cloud: ${app.cloud.baseUrl}`,
      `[MJH] Token source: config`,
      `[MJH] Printer: ${app.printer.model} @ ${app.printer.ip}:${app.printer.port}`,
      `[MJH] Waiting for print jobs...`,
    ].join("\n");

    assert.equal(startupLines.includes("super-secret-token-xyz"), false);
    assert.equal(startupLines.includes(app.cloud.token), false);
  } finally {
    await rm(join(path, ".."), { recursive: true, force: true });
  }
});

test("BOM-prefixed config still loads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-cfg-bom-"));
  const path = join(dir, "printer.json");
  const body = JSON.stringify({
    store: { id: "store-1" },
    agent: { id: "kitchen-1", token: "bom-token", pollIntervalMs: 3000 },
    printer: {
      name: "Kitchen",
      model: "XP-N160II",
      ip: "127.0.0.1",
      port: 9100,
      encoding: "gb18030",
      connectTimeoutMs: 1000,
    },
    cloud: { baseUrl: "http://127.0.0.1:3001/v1" },
  });
  await writeFile(path, `\uFEFF${body}`, "utf8");
  try {
    const file = loadFileConfig(path);
    assert.equal(file.agent.token, "bom-token");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
