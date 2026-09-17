import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { StateStore } from "./state-store.js";

test("StateStore marks printed then acknowledged atomically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-state-"));
  const path = join(dir, "print-state.json");

  try {
    const store = new StateStore(path);
    await store.load();

    assert.equal(store.isPrinted("pj_1"), false);

    await store.markPrinted("pj_1", "2026-09-17T00:00:00.000Z");
    assert.equal(store.isPrinted("pj_1"), true);
    assert.equal(store.needsAck("pj_1"), true);

    const raw1 = await readFile(path, "utf8");
    const json1 = JSON.parse(raw1) as {
      completed: Record<string, { printedAt: string; acknowledged: boolean }>;
    };
    assert.equal(json1.completed.pj_1.acknowledged, false);

    await store.markAcknowledged("pj_1");
    assert.equal(store.needsAck("pj_1"), false);

    const reloaded = new StateStore(path);
    await reloaded.load();
    assert.equal(reloaded.isPrinted("pj_1"), true);
    assert.equal(reloaded.needsAck("pj_1"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("StateStore loads empty state when file is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-state-"));
  const path = join(dir, "missing-print-state.json");

  try {
    const store = new StateStore(path);
    await store.load();
    assert.equal(store.isPrinted("any"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
