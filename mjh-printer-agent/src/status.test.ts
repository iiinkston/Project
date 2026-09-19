import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StatusStore, writeStoppedStatus, readStatusFile } from "./status.js";

test("status.json has no token field and sets updatedAt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-status-"));
  const path = join(dir, "status.json");
  try {
    const store = new StatusStore(path, {
      version: "2.1.0",
      pid: 1,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cloud: { online: true, version: "x", commit: "abc", environment: "production" },
      printer: { online: true, ip: "192.168.0.110", port: 9100 },
      worker: {},
    });
    await store.save();
    const snap = store.getSnapshot();
    assert.equal("token" in snap, false);
    assert.ok(snap.updatedAt);
    const raw = await readFile(path, "utf8");
    assert.equal(raw.includes("token"), false);
    assert.ok(raw.includes("updatedAt"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("status refresh after restart overwrites old pid", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-status-restart-"));
  const path = join(dir, "status.json");
  try {
    const old = new StatusStore(path, {
      version: "2.1.1",
      pid: 26292,
      startedAt: "2026-09-19T07:20:22.242Z",
      updatedAt: "2026-09-19T07:20:22.242Z",
      cloud: { online: false },
      printer: { online: false, ip: "192.168.0.110", port: 9100 },
      worker: {},
    });
    await old.save();

    const startedAt = new Date().toISOString();
    const next = new StatusStore(path, {
      version: "2.1.3",
      pid: 19932,
      startedAt,
      updatedAt: startedAt,
      cloud: { online: false },
      printer: { online: false, ip: "192.168.0.110", port: 9100 },
      worker: {},
    });
    await next.save();

    const disk = await readStatusFile(path);
    assert.equal(disk?.pid, 19932);
    assert.equal(disk?.version, "2.1.3");
    assert.notEqual(disk?.startedAt, "2026-09-19T07:20:22.242Z");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeStoppedStatus clears online flags", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-status-stop-"));
  const path = join(dir, "status.json");
  try {
    const store = new StatusStore(path, {
      version: "2.1.3",
      pid: 99,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      cloud: { online: true },
      printer: { online: true, ip: "192.168.0.110", port: 9100 },
      worker: {},
    });
    await store.save();
    await writeStoppedStatus(path);
    const disk = await readStatusFile(path);
    assert.equal(disk?.pid, 0);
    assert.equal(disk?.cloud.online, false);
    assert.equal(disk?.printer.online, false);
    assert.equal(disk?.worker.lastError, "stopped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
