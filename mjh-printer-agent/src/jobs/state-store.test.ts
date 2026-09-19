import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
      completed: Record<string, { printedAt?: string; acknowledged: boolean }>;
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

test("kitchenSentAt persistence and no kitchen reprint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-state-"));
  const path = join(dir, "print-state.json");
  try {
    const store = new StateStore(path);
    await store.load();
    await store.markKitchenSent("pj_k", "2026-09-19T00:00:00.000Z");
    assert.equal(store.needsKitchen("pj_k"), false);
    assert.equal(store.needsCashier("pj_k"), true);
    assert.equal(store.isPrinted("pj_k"), false);

    const reloaded = new StateStore(path);
    await reloaded.load();
    assert.equal(reloaded.needsKitchen("pj_k"), false);
    assert.equal(reloaded.needsCashier("pj_k"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cashierSentAt persistence completes printed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-state-"));
  const path = join(dir, "print-state.json");
  try {
    const store = new StateStore(path);
    await store.load();
    await store.markKitchenSent("pj_c");
    await store.markCashierSent("pj_c");
    await store.markPrinted("pj_c");
    assert.equal(store.isPrinted("pj_c"), true);
    assert.equal(store.needsKitchen("pj_c"), false);
    assert.equal(store.needsCashier("pj_c"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("V1 state file backward compatibility", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-state-"));
  const path = join(dir, "print-state.json");
  try {
    await writeFile(
      path,
      JSON.stringify({
        completed: {
          legacy: { printedAt: "2026-09-01T00:00:00.000Z", acknowledged: false },
        },
      }),
      "utf8",
    );
    const store = new StateStore(path);
    await store.load();
    assert.equal(store.isPrinted("legacy"), true);
    assert.equal(store.needsKitchen("legacy"), false);
    assert.equal(store.needsCashier("legacy"), false);
    assert.equal(store.needsAck("legacy"), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
