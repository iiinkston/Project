import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AgentAlreadyRunningError, AgentLock } from "./agent-lock.js";

test("first instance acquires lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-"));
  const lockPath = join(dir, "agent.lock");
  const lock = new AgentLock(lockPath, "2.0.0");

  try {
    const info = await lock.acquire();
    assert.equal(info.pid, process.pid);
    assert.equal(info.version, "2.0.0");
    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("second instance is rejected when live PID lock is respected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-"));
  const lockPath = join(dir, "agent.lock");
  const first = new AgentLock(lockPath, "2.0.0");
  const second = new AgentLock(lockPath, "2.0.0");

  try {
    await first.acquire();
    await assert.rejects(() => second.acquire(), (error: unknown) => {
      assert.ok(error instanceof AgentAlreadyRunningError);
      assert.equal(error.existingPid, process.pid);
      return true;
    });
    await first.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale lock is recoverable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-"));
  const lockPath = join(dir, "agent.lock");

  try {
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 99999999, startedAt: "2020-01-01T00:00:00.000Z", version: "1.0.0" }),
      "utf8",
    );

    const lock = new AgentLock(lockPath, "2.0.0");
    const info = await lock.acquire();
    assert.equal(info.pid, process.pid);
    await lock.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("shutdown releases lock", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-lock-"));
  const lockPath = join(dir, "agent.lock");
  const first = new AgentLock(lockPath, "2.0.0");
  const second = new AgentLock(lockPath, "2.0.0");

  try {
    await first.acquire();
    await first.release();
    const info = await second.acquire();
    assert.equal(info.pid, process.pid);
    await second.release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
