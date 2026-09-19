import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, access, constants as fsConstants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FileConfig } from "./config.js";
import { loadFileConfig } from "./config.js";
import {
  mergeFileConfig,
  parseConfigSetArgs,
  serializeFileConfig,
  writeFileConfigAtomic,
} from "./config-write.js";

function sampleConfig(overrides?: Partial<FileConfig>): FileConfig {
  return {
    store: { id: "store-old" },
    agent: { id: "kitchen-old", token: "old-token", pollIntervalMs: 3000 },
    printer: {
      name: "Kitchen",
      model: "XP-N160II",
      ip: "192.168.0.110",
      port: 9100,
      encoding: "gb18030",
      connectTimeoutMs: 3000,
    },
    cloud: { baseUrl: "http://206.189.80.83/api/v1" },
    ...overrides,
  };
}

test("mergeFileConfig preserves printer and cloud by default", () => {
  const base = sampleConfig();
  const merged = mergeFileConfig(base, {
    storeId: "store-new",
    agentId: "kitchen-1",
    token: "new-token",
  });
  assert.equal(merged.store.id, "store-new");
  assert.equal(merged.agent.id, "kitchen-1");
  assert.equal(merged.agent.token, "new-token");
  assert.equal(merged.printer.ip, "192.168.0.110");
  assert.equal(merged.printer.port, 9100);
  assert.equal(merged.cloud.baseUrl, "http://206.189.80.83/api/v1");
});

test("parseConfigSetArgs reads store/agent/token flags", () => {
  const patch = parseConfigSetArgs([
    "--store-id",
    "abc",
    "--agent-id",
    "kitchen-1",
    "--token",
    "tok",
  ]);
  assert.equal(patch.storeId, "abc");
  assert.equal(patch.agentId, "kitchen-1");
  assert.equal(patch.token, "tok");
});

test("writeFileConfigAtomic writes UTF-8 without BOM and creates backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-cfg-write-"));
  const path = join(dir, "printer.json");
  const first = sampleConfig();
  await writeFile(path, serializeFileConfig(first), "utf8");

  const second = mergeFileConfig(first, { token: "rotated-token", storeId: "store-2" });
  const result = await writeFileConfigAtomic(path, second);

  assert.ok(result.backupPath);
  const backupRaw = await readFile(result.backupPath!, "utf8");
  assert.equal(JSON.parse(backupRaw).agent.token, "old-token");

  const written = await readFile(path);
  assert.notEqual(written[0], 0xef);
  assert.notEqual(written[1], 0xbb);
  assert.notEqual(written[2], 0xbf);

  const loaded = loadFileConfig(path);
  assert.equal(loaded.agent.token, "rotated-token");
  assert.equal(loaded.store.id, "store-2");
  assert.equal(loaded.printer.ip, "192.168.0.110");

  await rm(dir, { recursive: true, force: true });
});

test("writeFileConfigAtomic creates file when missing (migration path)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-cfg-new-"));
  const path = join(dir, "printer.json");
  const cfg = sampleConfig({ store: { id: "fresh" } });
  const result = await writeFileConfigAtomic(path, cfg);
  assert.equal(result.backupPath, null);
  await access(path, fsConstants.R_OK);
  const loaded = loadFileConfig(path);
  assert.equal(loaded.store.id, "fresh");
  await rm(dir, { recursive: true, force: true });
});

test("config path permission handling: serialize never embeds BOM", () => {
  const raw = serializeFileConfig(sampleConfig());
  const buf = Buffer.from(raw, "utf8");
  assert.equal(buf[0], "{".charCodeAt(0));
});
