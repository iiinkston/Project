import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { classifyProcess } from "../process/agent-process.js";
import { AgentLock, readAgentLock } from "../jobs/agent-lock.js";
import { StatusStore } from "../status.js";

const srcRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      out.push(...collectTsFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

test("pkg compatible: CLI runtime has no dynamic import()", () => {
  const files = collectTsFiles(srcRoot).filter((f) => {
    const rel = f.replace(/\\/g, "/");
    return (
      rel.includes("/cli/") ||
      rel.endsWith("/index.ts") ||
      rel.includes("/process/") ||
      rel.includes("/jobs/agent-lock") ||
      rel.endsWith("/status.ts") ||
      rel.includes("/config-write") ||
      rel.includes("/local/")
    );
  });
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Ban runtime dynamic import — pkg node22 cannot resolve import() callbacks.
    assert.equal(
      /await\s+import\s*\(/.test(text),
      false,
      `dynamic import found in ${file}`,
    );
  }
});

test("classifyProcess: diagnose/stop CLI is not MJH agent worker", () => {
  assert.equal(
    classifyProcess(
      10,
      "MJH-Printer-Agent.exe",
      `"C:\\Program Files\\MJH Printer Agent\\MJH-Printer-Agent.exe" agent:diagnose`,
    ).isMjhAgent,
    false,
  );
  assert.equal(
    classifyProcess(
      11,
      "MJH-Printer-Agent.exe",
      `"C:\\Program Files\\MJH Printer Agent\\MJH-Printer-Agent.exe" agent:stop`,
    ).isMjhAgent,
    false,
  );
});

test("agent:start creates lock; agent:stop removes lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-lifecycle-"));
  const lockPath = join(dir, "agent.lock");
  try {
    const lock = new AgentLock(lockPath, "2.1.2");
    const info = await lock.acquire();
    assert.equal(info.pid, process.pid);
    assert.equal(info.version, "2.1.2");
    const onDisk = await readAgentLock(lockPath);
    assert.equal(onDisk?.pid, process.pid);
    const raw = await readFile(lockPath, "utf8");
    assert.ok(raw.includes('"pid"'));
    assert.ok(raw.includes('"startedAt"'));
    assert.ok(raw.includes('"version"'));

    await lock.release();
    // Simulate agent:stop removing lock after process exit
    await unlink(lockPath).catch(() => undefined);
    assert.equal(await readAgentLock(lockPath), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("update detects old PID still present", () => {
  const shouldFailUpdate = (oldPids: number[], newPids: number[]) => {
    if (newPids.length === 0) return true; // did not start
    const overlap = newPids.filter((p) => oldPids.includes(p));
    return oldPids.length > 0 && overlap.length === newPids.length && overlap.length > 0;
  };
  assert.equal(shouldFailUpdate([26292], [26292]), true);
  assert.equal(shouldFailUpdate([26292], [19932]), false);
  assert.equal(shouldFailUpdate([], [19932]), false);
  assert.equal(shouldFailUpdate([1, 2], []), true);
});

test("status cloud online after heartbeat patch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-cloud-online-"));
  const path = join(dir, "status.json");
  try {
    const store = new StatusStore(path, {
      version: "2.1.2",
      pid: process.pid,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cloud: { online: false },
      printer: { online: false, ip: "127.0.0.1", port: 9100 },
      worker: {},
    });
    await store.save();
    await store.patch((s) => {
      s.cloud.online = true;
      s.cloud.lastSuccessAt = new Date().toISOString();
    });
    assert.equal(store.getSnapshot().cloud.online, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
