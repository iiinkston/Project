import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadFileConfig } from "../config.js";
import { handleLocalBind, handleLocalStatus } from "../local/router.js";
import { pairWithCloud } from "./pair.js";

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
