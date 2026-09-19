import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadFileConfig } from "../config.js";
import { handleLocalBind, handleLocalStatus } from "../local/router.js";
import { pairWithCloud } from "./pair.js";
import { extractApiErrorMessage } from "./api-error.js";

test("pairWithCloud reads nested cloud error message", async () => {
  const server = createServer((req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "code must be a string" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await assert.rejects(
      () =>
        pairWithCloud({
          baseUrl: `http://127.0.0.1:${addr.port}/api/v1`,
          pairCode: "MJH-KL-002",
        }),
      /code must be a string/,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("pairWithCloud accepts production payload without success flag", async () => {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      const body = JSON.parse(raw) as { code?: string; pairCode?: string };
      assert.equal(body.code, "MJH-KL-009");
      assert.equal(body.pairCode, undefined);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          storeName: "Man Jiang Hong",
          storeId: "store-prod",
          agentKey: "kitchen-1",
          token: "prod-token-value-32chars-minimum!!",
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    const paired = await pairWithCloud({
      baseUrl: `http://127.0.0.1:${addr.port}/api/v1`,
      pairCode: "MJH-KL-009",
    });
    assert.equal(paired.storeId, "store-prod");
    assert.equal(paired.agentId, "kitchen-1");
    assert.equal(paired.agentName, "kitchen-1");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("pairWithCloud parses one-time credentials", async () => {
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        storeName: "满江红",
        agentName: "kitchen-1",
        storeId: "store-abc",
        agentId: "kitchen-1",
        token: "pair-token-value-32chars-minimum!!",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    const paired = await pairWithCloud({
      baseUrl: `http://127.0.0.1:${addr.port}/api/v1`,
      pairCode: "MJH-KL-001",
    });
    assert.equal(paired.storeName, "满江红");
    assert.equal(paired.token.startsWith("pair-token"), true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("handleLocalBind writes token but response has no secrets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-bind-"));
  const cfgPath = join(dir, "printer.json");
  const prev = process.env.MJH_CONFIG_PATH;

  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        storeName: "满江红马来西亚店",
        agentName: "kitchen-1",
        storeId: "store-xyz",
        agentId: "kitchen-1",
        token: "secret-bind-token-do-not-leak!!!!",
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");

  try {
    await writeFile(
      cfgPath,
      JSON.stringify(
        {
          store: { id: "unbound" },
          agent: { id: "kitchen-1", pollIntervalMs: 3000 },
          printer: {
            name: "Kitchen",
            model: "XP-N160II",
            ip: "192.168.0.110",
            port: 9100,
            encoding: "gb18030",
            connectTimeoutMs: 3000,
          },
          cloud: { baseUrl: `http://127.0.0.1:${addr.port}/api/v1` },
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.MJH_CONFIG_PATH = cfgPath;

    const result = await handleLocalBind({ code: "MJH-KL-001" });
    assert.equal("success" in result && result.success, true);
    if ("success" in result && result.success) {
      assert.equal(result.storeName, "满江红马来西亚店");
      assert.equal(result.agentName, "kitchen-1");
    }
    const text = JSON.stringify(result);
    assert.equal(/token/i.test(text), false);
    assert.equal(/storeId/i.test(text), false);
    assert.equal(/agentId/i.test(text), false);
    assert.equal(text.includes("secret-bind"), false);

    const loaded = loadFileConfig(cfgPath);
    assert.equal(loaded.agent.token, "secret-bind-token-do-not-leak!!!!");
    assert.equal(loaded.store.id, "store-xyz");
    assert.equal(loaded.store.name, "满江红马来西亚店");

    const status = await handleLocalStatus();
    assert.equal(status.bound, true);
    assert.equal(status.storeName, "满江红马来西亚店");
    assert.equal(JSON.stringify(status).includes("secret-bind"), false);
  } finally {
    if (prev === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prev;
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
});

function unboundConfig(baseUrl: string) {
  return {
    store: { id: "unbound" },
    agent: { id: "kitchen-1", token: null, pollIntervalMs: 3000 },
    printer: {
      name: "Kitchen",
      model: "XP-N160II",
      ip: "192.168.0.110",
      port: 9100,
      encoding: "gb18030",
      connectTimeoutMs: 3000,
    },
    cloud: { baseUrl },
  };
}

test("extractApiErrorMessage reads error.message and never stringifies as [object Object]", () => {
  const message = extractApiErrorMessage({
    error: { code: "PAIRING_CODE_INVALID", message: "PAIRING_CODE_INVALID" },
  });
  assert.equal(message, "PAIRING_CODE_INVALID");
  assert.equal(message.includes("[object Object]"), false);
  const dumped = extractApiErrorMessage({
    error: { code: "X", token: "super-secret-token-value" },
  });
  assert.equal(dumped.includes("super-secret-token-value"), false);
  assert.equal(dumped.includes("***"), true);
});

test("long-lived code MJH-001 binds and rebinds with a new token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-rebind-"));
  const cfgPath = join(dir, "printer.json");
  const prev = process.env.MJH_CONFIG_PATH;
  let calls = 0;
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = JSON.parse(raw) as { code?: string; pairCode?: string };
      assert.equal(body.code, "MJH-001");
      assert.equal(body.pairCode, undefined);
      calls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          storeName: "Man Jiang Hong",
          storeId: "store-live",
          agentKey: "kitchen-1",
          token: calls === 1 ? "first-token-value-32chars-minimum!" : "second-token-value-32chars-minimum",
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await writeFile(
      cfgPath,
      JSON.stringify(unboundConfig(`http://127.0.0.1:${addr.port}/api/v1`), null, 2),
      "utf8",
    );
    process.env.MJH_CONFIG_PATH = cfgPath;
    const loadedNull = loadFileConfig(cfgPath);
    assert.equal(loadedNull.agent.token, null);

    const first = await handleLocalBind({ code: "MJH-001" });
    assert.equal("success" in first && first.success, true);
    assert.equal(loadFileConfig(cfgPath).agent.token, "first-token-value-32chars-minimum!");

    const second = await handleLocalBind({ pairCode: "MJH-001" });
    assert.equal("success" in second && second.success, true);
    const rebound = loadFileConfig(cfgPath);
    assert.equal(rebound.store.id, "store-live");
    assert.equal(rebound.agent.id, "kitchen-1");
    assert.equal(rebound.agent.token, "second-token-value-32chars-minimum");
    assert.equal(JSON.stringify(second).includes("second-token"), false);
  } finally {
    if (prev === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prev;
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
});

test("invalid pair code returns the cloud error message", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-bind-bad-"));
  const cfgPath = join(dir, "printer.json");
  const prev = process.env.MJH_CONFIG_PATH;
  const server = createServer((_req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: { message: "PAIRING_CODE_INVALID" },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  try {
    await writeFile(
      cfgPath,
      JSON.stringify(unboundConfig(`http://127.0.0.1:${addr.port}/api/v1`), null, 2),
      "utf8",
    );
    process.env.MJH_CONFIG_PATH = cfgPath;
    const result = await handleLocalBind({ code: "BAD-CODE" });
    assert.equal("ok" in result && result.ok, false);
    if ("ok" in result && !result.ok) {
      assert.equal(result.error, "PAIRING_CODE_INVALID");
      assert.equal(result.error.includes("[object Object]"), false);
    }
  } finally {
    if (prev === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prev;
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await rm(dir, { recursive: true, force: true });
  }
});
