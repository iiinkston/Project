import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "node:http";
import { StatusStore } from "../status.js";
import { AgentRuntime, setAgentRuntime, getAgentRuntime } from "./agent-runtime.js";
import { isCloudAuthError } from "../jobs/worker.js";
import { handleLocalBind, handleLocalStatus } from "../local/router.js";
import { startLocalHttpServer } from "../local/http-server.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

test("isCloudAuthError detects 401 credential failures", () => {
  assert.equal(
    isCloudAuthError(
      new Error(
        "Cloud API error HTTP 401 on POST /printer/jobs/claim: Invalid printer agent credentials",
      ),
    ),
    true,
  );
  assert.equal(isCloudAuthError(new Error("Cloud API connection refused")), false);
});

test("unbound runtime has no worker; bind starts exactly one worker loop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-runtime-"));
  const prevConfig = process.env.MJH_CONFIG_PATH;
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "logs"), { recursive: true });

  let claimHits = 0;
  const cloud = createServer((req, res) => {
    if (req.url?.endsWith("/health") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", database: "up", version: "test" }));
      return;
    }
    if (req.url?.includes("/printer/pair") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          storeName: "Test Store",
          agentName: "kitchen-1",
          storeId: "store-rt-1",
          agentId: "kitchen-1",
          token: "runtime-bind-token-value-32chars-aa",
        }),
      );
      return;
    }
    if (req.url?.includes("/printer/jobs/claim") && req.method === "POST") {
      claimHits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ job: null }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });

  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

  const cfgPath = join(dir, "config", "printer.json");
  process.env.MJH_CONFIG_PATH = cfgPath;
  await writeFile(
    cfgPath,
    JSON.stringify(
      {
        store: { id: "unbound" },
        agent: { id: "kitchen-1", pollIntervalMs: 200 },
        printer: {
          name: "Kitchen",
          model: "XP-N160II",
          ip: "127.0.0.1",
          port: 9100,
          encoding: "gb18030",
          connectTimeoutMs: 500,
        },
        cloud: { baseUrl },
      },
      null,
      2,
    ),
    "utf8",
  );

  const statusPath = join(dir, "data", "status.json");
  const now = new Date().toISOString();
  const status = new StatusStore(statusPath, {
    version: "test",
    pid: process.pid,
    startedAt: now,
    updatedAt: now,
    cloud: { online: false },
    printer: { online: false, ip: "127.0.0.1", port: 9100 },
    worker: {},
  });
  await status.save();

  const runtime = new AgentRuntime(status);
  setAgentRuntime(runtime);

  try {
    assert.equal(runtime.getLifecycle(), "UNBOUND");
    assert.equal(runtime.isWorkerRunning(), false);

    const beforeClaims = claimHits;
    const bind = await handleLocalBind({ code: "MJH-001" });
    assert.equal(bind.success, true);
    if (!("cloudOnline" in bind)) throw new Error("expected LocalBindResponse");
    assert.equal(runtime.getLifecycle(), "RUNNING");
    assert.equal(runtime.isWorkerRunning(), true);

    // Polling should occur without process restart.
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline && claimHits <= beforeClaims) {
      await sleep(200);
    }
    assert.ok(claimHits > beforeClaims, "expected claim polling after bind");

    const st = await handleLocalStatus();
    assert.equal(st.bound, true);
    assert.equal(st.lifecycle, "RUNNING");
    assert.equal(JSON.stringify(st).includes("runtime-bind-token"), false);

    // Rebind: still exactly one worker (serialized activate).
    const hitsBeforeRebind = claimHits;
    const bind2 = await handleLocalBind({ code: "MJH-001" });
    assert.equal(bind2.success, true);
    assert.equal(runtime.getLifecycle(), "RUNNING");
    await sleep(600);
    assert.equal(runtime.isWorkerRunning(), true);
    // Still polling after rebind
    const deadline2 = Date.now() + 5_000;
    while (Date.now() < deadline2 && claimHits <= hitsBeforeRebind) {
      await sleep(200);
    }
    assert.ok(claimHits > hitsBeforeRebind, "expected polling after rebind");
  } finally {
    await runtime.shutdown();
    setAgentRuntime(null);
    cloud.close();
    if (prevConfig === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prevConfig;
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    await rm(dir, { recursive: true, force: true });
  }
});

test("bind failure leaves existing worker/config unaffected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-runtime-fail-"));
  const prevConfig = process.env.MJH_CONFIG_PATH;
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });

  const cloud = createServer((req, res) => {
    if (req.url?.includes("/printer/pair")) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: { message: "bad code" } }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");

  const cfgPath = join(dir, "config", "printer.json");
  process.env.MJH_CONFIG_PATH = cfgPath;
  const originalToken = "existing-token-must-remain-32chars-xx";
  await writeFile(
    cfgPath,
    JSON.stringify(
      {
        store: { id: "store-keep", name: "Keep Store" },
        agent: { id: "kitchen-1", token: originalToken, pollIntervalMs: 3000 },
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

  const now = new Date().toISOString();
  const status = new StatusStore(join(dir, "data", "status.json"), {
    version: "test",
    pid: 1,
    startedAt: now,
    updatedAt: now,
    cloud: { online: true },
    printer: { online: true, ip: "192.168.0.110", port: 9100 },
    worker: {},
  });
  const runtime = new AgentRuntime(status);
  setAgentRuntime(runtime);
  // Pretend already running
  (runtime as unknown as { lifecycle: string }).lifecycle = "RUNNING";

  try {
    const result = await handleLocalBind({ code: "BAD" });
    assert.equal("ok" in result && result.ok === false, true);
    const { loadFileConfig } = await import("../config.js");
    const file = loadFileConfig(cfgPath);
    assert.equal(file.agent.token, originalToken);
    assert.equal(file.store.id, "store-keep");
    assert.equal(runtime.getLifecycle(), "RUNNING");
  } finally {
    setAgentRuntime(null);
    cloud.close();
    if (prevConfig === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prevConfig;
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    await rm(dir, { recursive: true, force: true });
  }
});

test("getAgentRuntime registry", () => {
  setAgentRuntime(null);
  assert.equal(getAgentRuntime(), null);
});

test("cloud 401 keeps process alive and reports AUTH_FAILED", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-runtime-401-"));
  const prevConfig = process.env.MJH_CONFIG_PATH;
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "logs"), { recursive: true });

  const cloud = createServer((req, res) => {
    if (req.url?.endsWith("/health") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", database: "up" }));
      return;
    }
    if (req.url?.includes("/printer/pair") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          storeName: "Auth Store",
          storeId: "store-401",
          agentKey: "kitchen-1",
          token: "auth-fail-token-value-32chars-zzzz",
        }),
      );
      return;
    }
    if (req.url?.includes("/printer/jobs/claim") && req.method === "POST") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: { message: "Invalid printer agent credentials" },
        }),
      );
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const baseUrl = `http://127.0.0.1:${addr.port}/api/v1`;

  const cfgPath = join(dir, "config", "printer.json");
  process.env.MJH_CONFIG_PATH = cfgPath;
  await writeFile(
    cfgPath,
    JSON.stringify(
      {
        store: { id: "unbound" },
        agent: { id: "kitchen-1", pollIntervalMs: 200 },
        printer: {
          name: "Kitchen",
          model: "XP-N160II",
          ip: "127.0.0.1",
          port: 9100,
          encoding: "gb18030",
          connectTimeoutMs: 400,
        },
        cloud: { baseUrl },
      },
      null,
      2,
    ),
    "utf8",
  );

  const now = new Date().toISOString();
  const status = new StatusStore(join(dir, "data", "status.json"), {
    version: "test",
    pid: process.pid,
    startedAt: now,
    updatedAt: now,
    cloud: { online: false },
    printer: { online: false, ip: "127.0.0.1", port: 9100 },
    worker: {},
  });
  await status.save();
  const runtime = new AgentRuntime(status);
  setAgentRuntime(runtime);

  try {
    const bind = await handleLocalBind({ code: "MJH-001" });
    assert.equal(bind.success, true);
    assert.equal(runtime.isWorkerRunning(), true);

    const deadline = Date.now() + 10_000;
    let lastError = "";
    while (Date.now() < deadline) {
      const snap = status.getSnapshot();
      lastError = snap.worker.lastError ?? "";
      if (lastError.startsWith("AUTH_FAILED")) break;
      await sleep(200);
    }
    assert.ok(lastError.startsWith("AUTH_FAILED"), `expected AUTH_FAILED got ${lastError}`);
    assert.equal(status.getSnapshot().cloud.online, false);
    assert.equal(runtime.isWorkerRunning(), true);

    const { loadFileConfig } = await import("../config.js");
    const file = loadFileConfig(cfgPath);
    assert.equal(Boolean(file.agent.token?.trim()), true);
  } finally {
    await runtime.shutdown();
    setAgentRuntime(null);
    cloud.close();
    if (prevConfig === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prevConfig;
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    await rm(dir, { recursive: true, force: true });
  }
});

test("printer status refreshes after bind", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-runtime-printer-"));
  const prevConfig = process.env.MJH_CONFIG_PATH;
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "logs"), { recursive: true });

  const printer = createServer((_req, res) => {
    res.writeHead(200);
    res.end();
  });
  await new Promise<void>((resolve) => printer.listen(0, "127.0.0.1", resolve));
  const printerAddr = printer.address();
  if (!printerAddr || typeof printerAddr === "string") throw new Error("no printer port");
  const printerPort = printerAddr.port;

  const cloud = createServer((req, res) => {
    if (req.url?.endsWith("/health") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", database: "up" }));
      return;
    }
    if (req.url?.includes("/printer/pair") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          storeName: "Printer Store",
          storeId: "store-pr",
          agentKey: "kitchen-1",
          token: "printer-bind-token-value-32chars-yy",
        }),
      );
      return;
    }
    if (req.url?.includes("/printer/jobs/claim") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ job: null }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");

  const cfgPath = join(dir, "config", "printer.json");
  process.env.MJH_CONFIG_PATH = cfgPath;
  await writeFile(
    cfgPath,
    JSON.stringify(
      {
        store: { id: "unbound" },
        agent: { id: "kitchen-1", pollIntervalMs: 200 },
        printer: {
          name: "Kitchen",
          model: "XP-N160II",
          ip: "127.0.0.1",
          port: printerPort,
          encoding: "gb18030",
          connectTimeoutMs: 1000,
        },
        cloud: { baseUrl: `http://127.0.0.1:${addr.port}/api/v1` },
      },
      null,
      2,
    ),
    "utf8",
  );

  const now = new Date().toISOString();
  const status = new StatusStore(join(dir, "data", "status.json"), {
    version: "test",
    pid: process.pid,
    startedAt: now,
    updatedAt: now,
    cloud: { online: false },
    printer: { online: false, ip: "127.0.0.1", port: printerPort },
    worker: {},
  });
  await status.save();
  const runtime = new AgentRuntime(status);
  setAgentRuntime(runtime);

  try {
    assert.equal(status.getSnapshot().printer.online, false);
    const bind = await handleLocalBind({ code: "MJH-001" });
    assert.equal(bind.success, true);
    if ("printerOnline" in bind) {
      assert.equal(bind.printerOnline, true);
    }
    assert.equal(status.getSnapshot().printer.online, true);
    assert.equal(status.getSnapshot().printer.port, printerPort);
  } finally {
    await runtime.shutdown();
    setAgentRuntime(null);
    cloud.close();
    printer.close();
    if (prevConfig === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prevConfig;
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    await rm(dir, { recursive: true, force: true });
  }
});

test("bind never logs plaintext token", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-runtime-noleak-"));
  const prevConfig = process.env.MJH_CONFIG_PATH;
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  await mkdir(join(dir, "config"), { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  await mkdir(join(dir, "logs"), { recursive: true });

  const secretToken = "super-secret-token-must-not-log-32xx";
  const cloud = createServer((req, res) => {
    if (req.url?.endsWith("/health") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", database: "up" }));
      return;
    }
    if (req.url?.includes("/printer/pair") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          storeName: "Leak Check",
          storeId: "store-leak",
          agentKey: "kitchen-1",
          token: secretToken,
        }),
      );
      return;
    }
    if (req.url?.includes("/printer/jobs/claim") && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ job: null }));
      return;
    }
    res.writeHead(404);
    res.end("{}");
  });
  await new Promise<void>((resolve) => cloud.listen(0, "127.0.0.1", resolve));
  const addr = cloud.address();
  if (!addr || typeof addr === "string") throw new Error("no port");

  const cfgPath = join(dir, "config", "printer.json");
  process.env.MJH_CONFIG_PATH = cfgPath;
  await writeFile(
    cfgPath,
    JSON.stringify(
      {
        store: { id: "unbound" },
        agent: { id: "kitchen-1", pollIntervalMs: 200 },
        printer: {
          name: "Kitchen",
          model: "XP-N160II",
          ip: "127.0.0.1",
          port: 9100,
          encoding: "gb18030",
          connectTimeoutMs: 400,
        },
        cloud: { baseUrl: `http://127.0.0.1:${addr.port}/api/v1` },
      },
      null,
      2,
    ),
    "utf8",
  );

  const now = new Date().toISOString();
  const status = new StatusStore(join(dir, "data", "status.json"), {
    version: "test",
    pid: process.pid,
    startedAt: now,
    updatedAt: now,
    cloud: { online: false },
    printer: { online: false, ip: "127.0.0.1", port: 9100 },
    worker: {},
  });
  await status.save();
  const runtime = new AgentRuntime(status);
  setAgentRuntime(runtime);

  try {
    const bind = await handleLocalBind({ code: "MJH-001" });
    assert.equal(bind.success, true);
    assert.equal(JSON.stringify(bind).includes(secretToken), false);

    const st = await handleLocalStatus();
    assert.equal(JSON.stringify(st).includes(secretToken), false);

    const { readdirSync, readFileSync } = await import("node:fs");
    const logsDir = join(dir, "logs");
    for (const name of readdirSync(logsDir)) {
      const text = readFileSync(join(logsDir, name), "utf8");
      assert.equal(text.includes(secretToken), false, `token leaked in ${name}`);
    }
  } finally {
    await runtime.shutdown();
    setAgentRuntime(null);
    cloud.close();
    if (prevConfig === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prevConfig;
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    await rm(dir, { recursive: true, force: true });
  }
});

test("Local API still binds localhost after runtime import", async () => {
  const port = 17993;
  const api = await startLocalHttpServer({ host: "127.0.0.1", port });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/local/health`);
    assert.equal(res.status, 200);
  } finally {
    await api.close();
  }
});
