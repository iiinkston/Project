import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import type { PrintJob } from "../cloud/types.js";
import {
  FEED_BEFORE_CUT_CASHIER,
  FEED_BEFORE_CUT_KITCHEN,
  LINE_WIDTH,
  buildCashierReceiptV2,
  buildJobReceipts,
  buildKitchenReceipt,
  buildKitchenReceiptV2,
  buildKitchenTestReceipt,
  buildOrderReceipt,
  displayWidth,
  isV2Payload,
  packSegments,
  wrapByDisplayWidth,
} from "./receipt.js";

const CUT = Buffer.from([0x1d, 0x56, 0x00]);
const FEED_KITCHEN = Buffer.from([0x1b, 0x64, FEED_BEFORE_CUT_KITCHEN]);
const FEED_CASHIER = Buffer.from([0x1b, 0x64, FEED_BEFORE_CUT_CASHIER]);

function decode(buffer: Buffer): string {
  return iconv.decode(buffer, "gb18030");
}

function countPattern(buffer: Buffer, pattern: Buffer): number {
  let count = 0;
  for (let i = 0; i <= buffer.length - pattern.length; i += 1) {
    if (buffer.subarray(i, i + pattern.length).equals(pattern)) {
      count += 1;
    }
  }
  return count;
}

const v1Job: PrintJob = {
  id: "pj_v1",
  orderId: "ord_v1",
  type: "KITCHEN_ORDER",
  createdAt: "2026-09-17T08:00:00.000Z",
  payload: {
    table: "A08",
    orderNumber: "MJH-20260917-0018",
    items: [
      { name: "担担面", quantity: 1, notes: "少辣" },
      {
        name: "小火锅套餐",
        quantity: 1,
        options: ["牛油麻辣", "芝士香肠"],
      },
    ],
    notes: "不要香菜",
  },
};

const v2DineInJob: PrintJob = {
  id: "pj_v2",
  orderId: "ord_v2",
  type: "KITCHEN_ORDER",
  createdAt: "2026-09-17T09:50:00.000Z",
  payload: {
    fulfillmentType: "DINE_IN",
    table: "1",
    orderNumber: "MJH-20260917-0010",
    createdAt: "2026-09-17T09:50:00.000Z",
    currency: "MYR",
    items: [
      {
        name: "孜然小鸡串",
        quantity: 5,
        unitPrice: 120,
        lineTotal: 600,
        notes: "",
        options: [],
        optionDetails: [],
      },
      {
        name: "担担面",
        quantity: 1,
        unitPrice: 1390,
        lineTotal: 1390,
        notes: "",
        options: ["加面"],
        optionDetails: [
          {
            name: "加面",
            groupName: "加料",
            chargedAmount: 0,
            standalonePrice: 300,
            bundleSurcharge: null,
            isOverage: false,
          },
        ],
      },
      {
        name: "小火锅套餐",
        quantity: 1,
        unitPrice: 1090,
        lineTotal: 1090,
        notes: "不要辣",
        optionDetails: [
          { name: "牛油麻辣", chargedAmount: 0 },
          { name: "桌面自煮小火锅", chargedAmount: 0 },
          { name: "唯一面", chargedAmount: 0 },
          { name: "伊面", chargedAmount: 0 },
          { name: "豆签", chargedAmount: 0 },
          { name: "米粉", chargedAmount: 0 },
        ],
      },
      {
        name: "可乐",
        quantity: 1,
        unitPrice: 380,
        lineTotal: 380,
      },
    ],
    subtotal: 3460,
    serviceCharge: 0,
    tax: 0,
    total: 3460,
    notes: "不要香菜",
  },
};

const v2EmptyNotes: PrintJob = {
  ...v2DineInJob,
  id: "pj_empty_notes",
  payload: {
    ...v2DineInJob.payload,
    notes: "",
    items: [
      {
        name: "可乐",
        quantity: 1,
        unitPrice: 380,
        lineTotal: 380,
        notes: "",
      },
    ],
  },
};

const v2WithFees: PrintJob = {
  ...v2DineInJob,
  id: "pj_fees",
  payload: {
    ...v2DineInJob.payload,
    serviceCharge: 346,
    tax: 208,
    total: 4014,
  },
};

const v2ChargedOption: PrintJob = {
  ...v2DineInJob,
  id: "pj_charge",
  payload: {
    ...v2DineInJob.payload,
    items: [
      {
        name: "担担面",
        quantity: 1,
        unitPrice: 1290,
        lineTotal: 1490,
        optionDetails: [
          {
            name: "加面",
            chargedAmount: 200,
            standalonePrice: 300,
            bundleSurcharge: null,
            isOverage: false,
          },
        ],
      },
    ],
    subtotal: 1490,
    total: 1490,
  },
};

const v2TakeawayJob: PrintJob = {
  ...v2DineInJob,
  id: "pj_takeaway",
  payload: {
    ...v2DineInJob.payload,
    fulfillmentType: "TAKEAWAY",
    table: "9",
  },
};

const longNameJob: PrintJob = {
  ...v2DineInJob,
  id: "pj_long",
  payload: {
    ...v2DineInJob.payload,
    items: [
      {
        name: "特长超级豪华满江红招牌孜然小鸡串大份加量套餐",
        quantity: 2,
        unitPrice: 120,
        lineTotal: 240,
      },
    ],
    subtotal: 240,
    total: 240,
    notes: "",
  },
};

test("V2 kitchen copy contains 厨房联", () => {
  const text = decode(buildKitchenReceiptV2(v2DineInJob));
  assert.ok(text.includes("【厨房联】"));
});

test("V2 cashier copy contains 收银联", () => {
  const text = decode(buildCashierReceiptV2(v2DineInJob));
  assert.ok(text.includes("【收银联】"));
});

test("kitchen copy has no item unit prices", () => {
  const text = decode(buildKitchenReceiptV2(v2DineInJob));
  assert.equal(text.includes("1.20"), false);
  assert.equal(text.includes("13.90"), false);
  assert.equal(text.includes("× 1.20"), false);
});

test("kitchen copy has no subtotal/total", () => {
  const text = decode(buildKitchenReceiptV2(v2DineInJob));
  assert.equal(text.includes("小计"), false);
  assert.equal(text.includes("合计"), false);
});

test("cashier copy has item prices", () => {
  const text = decode(buildCashierReceiptV2(v2DineInJob));
  assert.ok(text.includes("1.20") || text.includes("5×1.20") || text.includes("5 × 1.20"));
  assert.ok(text.includes("6.00"));
});

test("cashier copy has subtotal and total", () => {
  const text = decode(buildCashierReceiptV2(v2DineInJob));
  assert.ok(text.includes("小计"));
  assert.ok(text.includes("合计"));
  assert.ok(text.includes("34.60"));
  assert.ok(text.includes("RM 34.60"));
});

test("serviceCharge=0 is hidden", () => {
  const text = decode(buildCashierReceiptV2(v2DineInJob));
  assert.equal(text.includes("服务费"), false);
});

test("tax=0 is hidden", () => {
  const text = decode(buildCashierReceiptV2(v2DineInJob));
  assert.equal(text.includes("税费"), false);
});

test("non-zero service prints", () => {
  const text = decode(buildCashierReceiptV2(v2WithFees));
  assert.ok(text.includes("服务费"));
  assert.ok(text.includes("3.46"));
});

test("non-zero tax prints", () => {
  const text = decode(buildCashierReceiptV2(v2WithFees));
  assert.ok(text.includes("税费"));
  assert.ok(text.includes("2.08"));
});

test("zero-cost option does not print RM0.00", () => {
  const kitchen = decode(buildKitchenReceiptV2(v2DineInJob));
  const cashier = decode(buildCashierReceiptV2(v2DineInJob));
  assert.equal(kitchen.includes("RM0.00"), false);
  assert.equal(cashier.includes("RM0.00"), false);
  assert.ok(kitchen.includes("+ 加面"));
  assert.equal(kitchen.includes("+RM3.00"), false);
  assert.equal(kitchen.includes("RM3.00"), false);
});

test("chargedAmount > 0 prints surcharge", () => {
  const text = decode(buildKitchenReceiptV2(v2ChargedOption));
  assert.ok(text.includes("+ 加面 +RM2.00"));
});

test("standalonePrice alone does not cause a surcharge to print", () => {
  const text = decode(buildKitchenReceiptV2(v2DineInJob));
  assert.ok(text.includes("+ 加面"));
  assert.equal(text.includes("RM3.00"), false);
});

test("multiple modifiers compact using /", () => {
  const text = decode(buildKitchenReceiptV2(v2DineInJob));
  assert.ok(text.includes(" / "));
  assert.ok(text.includes("牛油麻辣"));
});

test("Chinese display-width wrapping works", () => {
  assert.equal(displayWidth("ABC"), 3);
  assert.equal(displayWidth("满江红"), 6);
  const wrapped = wrapByDisplayWidth("一二三四五六七八九十一二三四五六七八九十", 10);
  assert.ok(wrapped.length >= 4);
  for (const line of wrapped) {
    assert.ok(displayWidth(line) <= 10);
  }
  const packed = packSegments(
    ["牛油麻辣", "桌面自煮小火锅", "白鱼丸", "鲍鱼菇", "杏鲍菇", "唯一面"],
    { maxWidth: LINE_WIDTH, indent: "  " },
  );
  assert.ok(packed.length < 6);
  assert.ok(packed.some((line) => line.includes(" / ")));
});

test("long Chinese product name does not overlap price columns", () => {
  const text = decode(buildCashierReceiptV2(longNameJob));
  assert.ok(text.includes("特长超级豪华"));
  assert.ok(text.includes("2.40") || text.includes("240") || text.includes("2 × 1.20") || text.includes("2×1.20"));
  const lines = text.split("\n").filter((line) => line.includes("1.20") || line.includes("2.40"));
  for (const line of lines) {
    assert.ok(displayWidth(line.replace(/[^\x20-\x7e\u4e00-\u9fff]/g, "")) <= LINE_WIDTH + 4);
  }
});

test("DINE_IN displays table", () => {
  const text = decode(buildKitchenReceiptV2(v2DineInJob));
  assert.ok(text.includes("堂食"));
  assert.ok(text.includes("桌1"));
  assert.ok(text.includes("#0010"));
});

test("TAKEAWAY hides table", () => {
  const text = decode(buildKitchenReceiptV2(v2TakeawayJob));
  assert.ok(text.includes("外带"));
  assert.equal(text.includes("桌9"), false);
});

test("empty order note does not print blank notes section", () => {
  const text = decode(buildKitchenReceiptV2(v2EmptyNotes));
  assert.equal(text.includes("备注："), false);
});

test("kitchen has 4 feeds before cut", () => {
  assert.equal(FEED_BEFORE_CUT_KITCHEN, 4);
  const buffer = buildKitchenReceiptV2(v2DineInJob);
  assert.ok(buffer.includes(FEED_KITCHEN));
  assert.equal(buffer.includes(FEED_CASHIER), false);
  const feedAt = buffer.indexOf(FEED_KITCHEN);
  const cutAt = buffer.indexOf(CUT);
  assert.ok(feedAt >= 0 && cutAt > feedAt);
});

test("cashier remains 3 feeds before cut", () => {
  assert.equal(FEED_BEFORE_CUT_CASHIER, 3);
  const buffer = buildCashierReceiptV2(v2DineInJob);
  assert.ok(buffer.includes(FEED_CASHIER));
  assert.equal(buffer.includes(FEED_KITCHEN), false);
  const feedAt = buffer.indexOf(FEED_CASHIER);
  const cutAt = buffer.indexOf(CUT);
  assert.ok(feedAt >= 0 && cutAt > feedAt);
});

test("both copies still cut twice", () => {
  const buffer = buildJobReceipts(v2DineInJob);
  assert.equal(countPattern(buffer, CUT), 2);
  assert.equal(countPattern(buffer, FEED_KITCHEN), 1);
  assert.equal(countPattern(buffer, FEED_CASHIER), 1);
});

test("V1 fallback remains supported", () => {
  assert.equal(isV2Payload(v1Job.payload), false);
  const text = decode(buildKitchenReceipt(v1Job));
  assert.ok(text.includes("【厨房联】"));
  assert.ok(text.includes("桌号：A08"));
  assert.ok(text.includes("担担面"));
});

test("buildKitchenTestReceipt remains available", () => {
  const text = decode(buildKitchenTestReceipt());
  assert.ok(text.includes("MJH-TEST-001"));
});

test("buildOrderReceipt kitchen export still works", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  assert.ok(text.includes("【厨房联】"));
});
