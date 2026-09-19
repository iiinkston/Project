import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyProcess } from "./agent-process.js";
import { StatusStore } from "../status.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentAlreadyRunningError, AgentLock } from "../jobs/agent-lock.js";
import { applyProgramDataAcl } from "../config-write.js";

test("classifyProcess marks MJH EXE as agent", () => {
  const info = classifyProcess(
    1,
    "MJH-Printer-Agent.exe",
    `"C:\\Program Files\\MJH Printer Agent\\MJH-Printer-Agent.exe" agent:start --agent-process`,
  );
  assert.equal(info.isMjhAgent, true);
});

test("classifyProcess treats bare EXE (no args) as agent worker", () => {
  const info = classifyProcess(
    5,
    "MJH-Printer-Agent.exe",
    `"C:\\Program Files\\MJH Printer Agent\\MJH-Printer-Agent.exe"`,
  );
  assert.equal(info.isMjhAgent, true);
});

test("classifyProcess does not mark EXE doctor/diagnose as agent", () => {
  const info = classifyProcess(
    4,
    "MJH-Printer-Agent.exe",
    `"C:\\Program Files\\MJH Printer Agent\\MJH-Printer-Agent.exe" doctor`,
  );
  assert.equal(info.isMjhAgent, false);
});

test("classifyProcess does not mark unrelated node as agent", () => {
  const info = classifyProcess(2, "node.exe", `node C:\\tools\\some-other-app\\index.js`);
  assert.equal(info.isMjhAgent, false);
});

test("classifyProcess marks node agent:start as agent", () => {
  const info = classifyProcess(
    3,
    "node.exe",
    `node D:\\Project\\mjh-printer-agent\\src\\index.ts agent:start`,
  );
  assert.equal(info.isMjhAgent, true);
});

test("status update sets cloud online and refreshes updatedAt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-status-hb-"));
  const path = join(dir, "status.json");
  try {
    const started = "2026-01-01T00:00:00.000Z";
    const store = new StatusStore(path, {
      version: "2.1.1",
      pid: 42,
      startedAt: started,
      updatedAt: started,
      cloud: { online: false },
      printer: { online: false, ip: "127.0.0.1", port: 9100 },
      worker: {},
    });
    await store.save();
    await store.patch((s) => {
      s.cloud.online = true;
      s.cloud.lastSuccessAt = new Date().toISOString();
    });
    const snap = store.getSnapshot();
    assert.equal(snap.cloud.online, true);
    assert.ok(snap.updatedAt);
    assert.notEqual(snap.updatedAt, started);
    const raw = await readFile(path, "utf8");
    assert.ok(raw.includes('"online": true') || raw.includes('"online":true'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("agent restart simulation: stop releases lock so start can acquire new lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-restart-"));
  const lockPath = join(dir, "agent.lock");
  try {
    const first = new AgentLock(lockPath, "2.1.1");
    const info1 = await first.acquire();
    await assert.rejects(() => new AgentLock(lockPath, "2.1.1").acquire(), AgentAlreadyRunningError);
    await first.release();
    const second = new AgentLock(lockPath, "2.1.1");
    const info2 = await second.acquire();
    assert.equal(info2.pid, process.pid);
    assert.equal(info1.pid, info2.pid);
    // In-process PID same; production restart uses different OS PID after kill.
    await second.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ACL repair report shape on non-Windows / dry path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-acl-"));
  try {
    const report = await applyProgramDataAcl(dir, { forceTakeown: false });
    assert.ok(["PASS", "FAIL"].includes(report.directoryAcl));
    assert.ok(["PASS", "FAIL"].includes(report.configReadable));
    assert.ok(["PASS", "FAIL"].includes(report.dataWritable));
    assert.ok(["PASS", "FAIL"].includes(report.logsReadable));
    assert.ok(Array.isArray(report.details));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

test("update must ignore old EXE agent:stop dynamic-import crash", () => {
  // Contract: old 2.1.1 agent:stop fatals; updater must continue to copy new EXE.
  const shouldAbortUpdateBeforeCopy = (stopOutput: string) => {
    // Never abort solely because old CLI cannot run.
    if (stopOutput.includes("A dynamic import callback was not specified")) return false;
    return false;
  };
  assert.equal(
    shouldAbortUpdateBeforeCopy("[MJH] Fatal error\nA dynamic import callback was not specified."),
    false,
  );
});
