import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  AgentAlreadyRunningError,
  AgentLock,
  readAgentLock,
} from "./agent-lock.js";

const INSTALLED_EXE = "C:\\Program Files\\MJH Printer Agent\\MJH-Printer-Agent.exe";
const FOREIGN_EXE = "C:\\Program Files\\NVIDIA Corporation\\NVDisplay.Container\\NVDisplay.Container.exe";

test("Case 1: live Agent PID with matching EXE blocks duplicate start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-c1-"));
  const lockPath = join(dir, "agent.lock");
  try {
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 4242,
        exePath: INSTALLED_EXE,
        createdAt: "2026-01-01T00:00:00.000Z",
        version: "2.4.4",
      }),
      "utf8",
    );

    const lock = new AgentLock(lockPath, "2.4.4", {
      currentPid: () => 9001,
      currentExePath: () => INSTALLED_EXE,
      isPidAlive: (pid) => pid === 4242,
      getExecutablePath: (pid) => (pid === 4242 ? INSTALLED_EXE : null),
    });

    await assert.rejects(() => lock.acquire(), (error: unknown) => {
      assert.ok(error instanceof AgentAlreadyRunningError);
      assert.equal(error.existingPid, 4242);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 2: lock PID no longer exists → auto cleanup and start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-c2-"));
  const lockPath = join(dir, "agent.lock");
  try {
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 99999999,
        exePath: INSTALLED_EXE,
        createdAt: "2020-01-01T00:00:00.000Z",
        version: "2.4.2",
      }),
      "utf8",
    );

    const lock = new AgentLock(lockPath, "2.4.4", {
      currentPid: () => 7001,
      currentExePath: () => INSTALLED_EXE,
      isPidAlive: () => false,
      getExecutablePath: () => null,
      nowIso: () => "2026-09-22T00:00:00.000Z",
    });

    const info = await lock.acquire();
    assert.equal(info.pid, 7001);
    assert.equal(info.exePath, INSTALLED_EXE);
    assert.equal(info.createdAt, "2026-09-22T00:00:00.000Z");
    assert.equal(info.version, "2.4.4");

    const onDisk = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
    assert.equal(onDisk.pid, 7001);
    assert.equal(onDisk.exePath, INSTALLED_EXE);
    assert.equal(onDisk.createdAt, "2026-09-22T00:00:00.000Z");
    assert.ok(!("startedAt" in onDisk));

    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 3: lock PID reused by foreign Windows process → stale and start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-c3-"));
  const lockPath = join(dir, "agent.lock");
  try {
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 3324,
        exePath: INSTALLED_EXE,
        createdAt: "2026-09-21T01:25:14.553Z",
        version: "2.4.2",
      }),
      "utf8",
    );

    const lock = new AgentLock(lockPath, "2.4.4", {
      currentPid: () => 8002,
      currentExePath: () => INSTALLED_EXE,
      isPidAlive: (pid) => pid === 3324,
      getExecutablePath: (pid) => (pid === 3324 ? FOREIGN_EXE : null),
    });

    const info = await lock.acquire();
    assert.equal(info.pid, 8002);
    assert.equal(info.exePath, INSTALLED_EXE);
    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 4: legacy lock (pid only, no exePath) → compatible cleanup or block", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-c4-"));
  const lockPath = join(dir, "agent.lock");
  try {
    // Legacy shape: only pid + startedAt (no exePath / createdAt).
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 3324,
        startedAt: "2026-09-21T01:25:14.553Z",
        version: "2.4.2",
      }),
      "utf8",
    );

    const parsed = await readAgentLock(lockPath);
    assert.equal(parsed?.pid, 3324);
    assert.equal(parsed?.exePath, "");
    assert.equal(parsed?.createdAt, "2026-09-21T01:25:14.553Z");

    // Foreign owner (PID reuse) → start
    const startLock = new AgentLock(lockPath, "2.4.4", {
      currentPid: () => 8100,
      currentExePath: () => INSTALLED_EXE,
      isPidAlive: (pid) => pid === 3324,
      getExecutablePath: (pid) => (pid === 3324 ? FOREIGN_EXE : null),
    });
    const info = await startLock.acquire();
    assert.equal(info.pid, 8100);
    await startLock.release();

    // Rewrite legacy again with live agent EXE → block
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 4242,
        startedAt: "2026-09-21T01:25:14.553Z",
        version: "2.4.2",
      }),
      "utf8",
    );
    const blockLock = new AgentLock(lockPath, "2.4.4", {
      currentPid: () => 8101,
      currentExePath: () => INSTALLED_EXE,
      isPidAlive: (pid) => pid === 4242,
      getExecutablePath: (pid) => (pid === 4242 ? INSTALLED_EXE : null),
    });
    await assert.rejects(() => blockLock.acquire(), AgentAlreadyRunningError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("same-process second acquire is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-same-"));
  const lockPath = join(dir, "agent.lock");
  const first = new AgentLock(lockPath, "2.4.4", {
    currentExePath: () => INSTALLED_EXE,
  });
  const second = new AgentLock(lockPath, "2.4.4", {
    currentExePath: () => INSTALLED_EXE,
  });

  try {
    await first.acquire();
    await assert.rejects(() => second.acquire(), AgentAlreadyRunningError);
    await first.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown releases lock for next start", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-rel-"));
  const lockPath = join(dir, "agent.lock");
  const first = new AgentLock(lockPath, "2.4.4", { currentExePath: () => INSTALLED_EXE });
  const second = new AgentLock(lockPath, "2.4.4", { currentExePath: () => INSTALLED_EXE });

  try {
    await first.acquire();
    await first.release();
    const info = await second.acquire();
    assert.equal(info.pid, process.pid);
    assert.ok(info.exePath);
    assert.ok(info.createdAt);
    await second.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
