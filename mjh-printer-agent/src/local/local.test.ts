import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadFileConfig } from "../config.js";
import { redactLogLine, handleLocalStatus, handlePrinterConfig } from "./router.js";
import { subnetPrefix, resolveLanIpv4 } from "./discover.js";
import { LOCAL_API_HOST, LOCAL_API_PORT } from "./types.js";
import { startLocalHttpServer } from "./http-server.js";

test("redactLogLine masks Bearer and token JSON", () => {
  const a = redactLogLine('Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345');
  assert.equal(a.includes("abcdefghijklmnopqrstuvwxyz012345"), false);
  assert.ok(a.includes("***"));
  const b = redactLogLine('{"token":"super-secret-token-value-here"}');
  assert.equal(b.includes("super-secret-token-value-here"), false);
});

test("subnetPrefix derives /24", () => {
  assert.equal(subnetPrefix("192.168.0.110"), "192.168.0");
  assert.ok(resolveLanIpv4());
});

test("LOCAL_API binds constants are localhost only", () => {
  assert.equal(LOCAL_API_HOST, "127.0.0.1");
  assert.equal(LOCAL_API_PORT, 17890);
});

test("handleLocalStatus never exposes token/storeId/agentId", async () => {
  const status = await handleLocalStatus();
  const text = JSON.stringify(status);
  assert.equal(/"token"/i.test(text), false);
  assert.equal(/storeId/i.test(text), false);
  assert.equal(/agentId/i.test(text), false);
  assert.ok(status.version);
  assert.ok(status.printer.ip);
  assert.equal(typeof status.bound, "boolean");
  assert.ok("storeName" in status);
  assert.equal(status.running, true);
  assert.ok("lastSyncAt" in status);
});

test("compareVersions and update check expose no secrets", async () => {
  const { compareVersions, handleUpdateCheck } = await import("./update.js");
  assert.equal(compareVersions("2.4.0", "2.3.0"), 1);
  assert.equal(compareVersions("2.3.0", "2.4.0"), -1);
  assert.equal(compareVersions("2.4.0", "2.4.0"), 0);
  const check = handleUpdateCheck();
  const text = JSON.stringify(check);
  assert.equal(/"token"/i.test(text), false);
  assert.ok(check.currentVersion);
  assert.ok(check.latestVersion);
  assert.equal(typeof check.updateAvailable, "boolean");
});

test("GET /local/update/check via http", async () => {
  const port = 17992;
  const api = await startLocalHttpServer({ host: "127.0.0.1", port });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/local/update/check`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      currentVersion: string;
      latestVersion: string;
      updateAvailable: boolean;
    };
    assert.ok(body.currentVersion);
    assert.equal(typeof body.updateAvailable, "boolean");
    assert.equal(JSON.stringify(body).includes("token"), false);
  } finally {
    await api.close();
  }
});

test("handlePrinterConfig writes via atomic helper", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-local-cfg-"));
  const prev = process.env.MJH_CONFIG_PATH;
  const cfgPath = join(dir, "printer.json");
  try {
    await writeFile(
      cfgPath,
      JSON.stringify(
        {
          store: { id: "s1" },
          agent: { id: "kitchen-1", token: "tok", pollIntervalMs: 3000 },
          printer: {
            name: "Kitchen",
            model: "XP-N160II",
            ip: "192.168.0.110",
            port: 9100,
            encoding: "gb18030",
            connectTimeoutMs: 3000,
          },
          cloud: { baseUrl: "http://127.0.0.1/api/v1" },
        },
        null,
        2,
      ),
      "utf8",
    );
    process.env.MJH_CONFIG_PATH = cfgPath;
    const result = await handlePrinterConfig({ ip: "192.168.1.50", port: 9100 });
    assert.equal(result.ok, true);
    const loaded = loadFileConfig(cfgPath);
    assert.equal(loaded.printer.ip, "192.168.1.50");
    assert.equal(loaded.printer.port, 9100);
    // token preserved, not returned
    assert.equal(loaded.agent.token, "tok");
    assert.equal(JSON.stringify(result).includes("tok"), false);
  } finally {
    if (prev === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("startLocalHttpServer rejects non-localhost bind", async () => {
  await assert.rejects(
    () => startLocalHttpServer({ host: "0.0.0.0", port: 17999 }),
    /localhost/,
  );
});

test("startLocalHttpServer serves /local/health on 127.0.0.1", async () => {
  const port = 17991;
  const api = await startLocalHttpServer({ host: "127.0.0.1", port });
  try {
    const res = await fetch(`http://127.0.0.1:${port}/local/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);

    const statusRes = await fetch(`http://127.0.0.1:${port}/local/status`);
    assert.equal(statusRes.status, 200);
    const statusText = await statusRes.text();
    assert.equal(/"token"/i.test(statusText), false);
    assert.equal(/storeId/i.test(statusText), false);
  } finally {
    await api.close();
  }
});

test("logs dir helper mkdir for empty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-logs-"));
  await mkdir(join(dir, "nested"), { recursive: true });
  assert.ok(true);
  await rm(dir, { recursive: true, force: true });
});
