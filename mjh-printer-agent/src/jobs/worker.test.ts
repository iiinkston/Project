import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AppConfig } from "../config.js";
import type { ApiClient } from "../cloud/api-client.js";
import type { PrintJob } from "../cloud/types.js";
import type { PrinterClient } from "../printer/printer.js";
import { PrintWorker } from "./worker.js";
import { StateStore } from "./state-store.js";

const v2Job: PrintJob = {
  id: "pj_once",
  orderId: "ord_once",
  type: "KITCHEN_ORDER",
  createdAt: "2026-09-17T08:00:00.000Z",
  payload: {
    fulfillmentType: "DINE_IN",
    table: "1",
    orderNumber: "MJH-20260917-0002",
    currency: "MYR",
    items: [
      {
        name: "担担面",
        quantity: 1,
        unitPrice: 1290,
        lineTotal: 1290,
      },
    ],
    subtotal: 1290,
    serviceCharge: 0,
    tax: 0,
    total: 1290,
  },
};

function fakeConfig(): AppConfig {
  return {
    store: { id: "store-1" },
    agent: { id: "kitchen-1", pollIntervalMs: 100 },
    printer: {
      name: "Kitchen",
      model: "XP-N160II",
      ip: "127.0.0.1",
      port: 9100,
      encoding: "gb18030",
      connectTimeoutMs: 1000,
    },
    cloud: {
      baseUrl: "http://127.0.0.1:3001/v1",
      token: "test-token",
      requestTimeoutMs: 1000,
    },
    version: "2.1.0",
    configPath: "C:\\tmp\\printer.json",
    dataDir: "C:\\tmp\\data",
    logsDir: "C:\\tmp\\logs",
  };
}

test("exactly two receipt sends and complete once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-worker-"));
  const statePath = join(dir, "print-state.json");

  let completeCalls = 0;
  let sendCalls = 0;

  const api = {
    async claimJob() {
      return null;
    },
    async completeJob() {
      completeCalls += 1;
    },
    async failJob() {
      throw new Error("failJob should not be called");
    },
  } as unknown as ApiClient;

  const fakePrinter = {
    async testConnection() {
      return true;
    },
    async connect() {
      return;
    },
    async send() {
      sendCalls += 1;
    },
    async close() {
      return;
    },
  } as unknown as PrinterClient;

  try {
    const worker = new PrintWorker(fakeConfig(), new StateStore(statePath), {
      api,
      createPrinter: () => fakePrinter,
    });

    await worker.processClaimedJobForTest(v2Job);

    assert.equal(sendCalls, 2);
    assert.equal(completeCalls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("crash after kitchen does not reprint kitchen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-worker-k-"));
  const statePath = join(dir, "print-state.json");
  let sendCalls = 0;
  let completeCalls = 0;

  const api = {
    async claimJob() {
      return null;
    },
    async completeJob() {
      completeCalls += 1;
    },
    async failJob() {
      return;
    },
  } as unknown as ApiClient;

  const fakePrinter = {
    async testConnection() {
      return true;
    },
    async connect() {
      return;
    },
    async send() {
      sendCalls += 1;
    },
    async close() {
      return;
    },
  } as unknown as PrinterClient;

  try {
    const store = new StateStore(statePath);
    await store.load();
    await store.markKitchenSent(v2Job.id);

    const worker = new PrintWorker(fakeConfig(), store, {
      api,
      createPrinter: () => fakePrinter,
    });
    await worker.processClaimedJobForTest(v2Job);

    // Only cashier should be sent
    assert.equal(sendCalls, 1);
    assert.equal(completeCalls, 1);
    assert.equal(store.needsKitchen(v2Job.id), false);
    assert.equal(store.needsCashier(v2Job.id), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("both copies sent + ACK failure does not reprint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-worker-ack-"));
  const statePath = join(dir, "print-state.json");
  let sendCalls = 0;
  let completeCalls = 0;

  const api = {
    async claimJob() {
      return null;
    },
    async completeJob() {
      completeCalls += 1;
      if (completeCalls === 1) {
        throw new Error("transient ACK failure");
      }
    },
    async failJob() {
      return;
    },
  } as unknown as ApiClient;

  const fakePrinter = {
    async testConnection() {
      return true;
    },
    async connect() {
      return;
    },
    async send() {
      sendCalls += 1;
    },
    async close() {
      return;
    },
  } as unknown as PrinterClient;

  try {
    const store = new StateStore(statePath);
    const worker = new PrintWorker(fakeConfig(), store, {
      api,
      createPrinter: () => fakePrinter,
    });

    await worker.processClaimedJobForTest(v2Job);
    assert.equal(sendCalls, 2);
    assert.equal(store.isPrinted(v2Job.id), true);

    // Second claim/process should only ACK, not reprint
    await worker.processClaimedJobForTest(v2Job);
    assert.equal(sendCalls, 2);
    assert.equal(completeCalls, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("StateStore ACK retry does not reprint", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-worker-ack2-"));
  const statePath = join(dir, "print-state.json");

  let completeCalls = 0;
  let sendCalls = 0;

  const api = {
    async claimJob() {
      return null;
    },
    async completeJob() {
      completeCalls += 1;
    },
    async failJob() {
      throw new Error("failJob should not be called");
    },
  } as unknown as ApiClient;

  const fakePrinter = {
    async testConnection() {
      return true;
    },
    async connect() {
      return;
    },
    async send() {
      sendCalls += 1;
    },
    async close() {
      return;
    },
  } as unknown as PrinterClient;

  try {
    const store = new StateStore(statePath);
    await store.load();
    await store.markPrinted(v2Job.id);

    const worker = new PrintWorker(fakeConfig(), store, {
      api,
      createPrinter: () => fakePrinter,
    });

    await worker.processClaimedJobForTest(v2Job);

    assert.equal(sendCalls, 0);
    assert.equal(completeCalls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
