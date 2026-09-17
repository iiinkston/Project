import assert from "node:assert/strict";
import { test } from "node:test";
import iconv from "iconv-lite";
import type { PrintJob } from "../cloud/types.js";
import {
  buildJobReceipts,
  buildKitchenReceipt,
  buildKitchenTestReceipt,
  buildOrderReceipt,
  isV2Payload,
  packSegments,
  wrapByDisplayWidth,
  displayWidth,
} from "./receipt.js";

const CUT = Buffer.from([0x1d, 0x56, 0x00]);

function decode(buffer: Buffer): string {
  return iconv.decode(buffer, "gb18030");
}

function countCuts(buffer: Buffer): number {
  let cuts = 0;
  for (let i = 0; i <= buffer.length - CUT.length; i += 1) {
    if (buffer.subarray(i, i + CUT.length).equals(CUT)) {
      cuts += 1;
    }
  }
  return cuts;
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
  createdAt: "2026-09-17T08:34:00.000Z",
  payload: {
    fulfillmentType: "DINE_IN",
    table: "1",
    orderNumber: "MJH-20260917-0004",
    createdAt: "2026-09-17T08:34:00.000Z",
    currency: "MYR",
    items: [
      {
        name: "孜然小鸡串",
        quantity: 5,
        unitPrice: 120,
        lineTotal: 600,
      },
      {
        name: "担担面",
        quantity: 1,
        unitPrice: 1390,
        lineTotal: 1390,
        notes: "少辣",
        optionDetails: [
          {
            name: "加面",
            groupName: "加料",
            chargedAmount: 200,
            standalonePrice: 200,
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
        optionDetails: [
          { name: "牛油麻辣", chargedAmount: 0 },
          { name: "桌面自煮小火锅", chargedAmount: 0 },
          { name: "白鱼丸", chargedAmount: 0 },
          { name: "鲍鱼菇", chargedAmount: 0 },
          { name: "杏鲍菇", chargedAmount: 0 },
          { name: "唯一面", chargedAmount: 0 },
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

const v2TakeawayJob: PrintJob = {
  ...v2DineInJob,
  id: "pj_v2_takeaway",
  payload: {
    ...v2DineInJob.payload,
    fulfillmentType: "TAKEAWAY",
    table: "9",
  },
};

test("V1 payload is not treated as V2", () => {
  assert.equal(isV2Payload(v1Job.payload), false);
});

test("V1 fallback still passes", () => {
  const text = decode(buildKitchenReceipt(v1Job));
  assert.ok(text.includes("【厨房联】"));
  assert.ok(text.includes("桌号：A08"));
  assert.ok(text.includes("担担面"));
  assert.ok(text.includes("不要香菜"));
  assert.equal(text.includes("小计"), false);
  assert.equal(text.includes("单价"), false);
});

test("kitchen copy does NOT contain item unit prices", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  assert.equal(text.includes("×1.20"), false);
  assert.equal(text.includes("1×"), false);
  assert.equal(text.includes("单价"), false);
  assert.ok(text.includes("孜然小鸡串 ×5"));
});

test("kitchen copy does NOT contain totals", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  assert.equal(text.includes("小计"), false);
  assert.equal(text.includes("合计"), false);
  assert.equal(text.includes("服务费"), false);
  assert.equal(text.includes("税费"), false);
  assert.equal(text.includes("TOTAL"), false);
});

test("cashier copy contains unit price + line total", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "cashier"));
  assert.ok(text.includes("5×1.20"));
  assert.ok(text.includes("6.00"));
  assert.ok(text.includes("1×13.90"));
  assert.ok(text.includes("13.90"));
});

test("serviceCharge=0 is hidden", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "cashier"));
  assert.equal(text.includes("服务费"), false);
});

test("tax=0 is hidden", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "cashier"));
  assert.equal(text.includes("税费"), false);
});

test("non-zero service charge prints", () => {
  const text = decode(buildOrderReceipt(v2WithFees, "cashier"));
  assert.ok(text.includes("服务费"));
  assert.ok(text.includes("3.46"));
});

test("non-zero tax prints", () => {
  const text = decode(buildOrderReceipt(v2WithFees, "cashier"));
  assert.ok(text.includes("税费"));
  assert.ok(text.includes("2.08"));
});

test("RM0.00 is not printed for zero-cost modifiers", () => {
  const kitchen = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  const cashier = decode(buildOrderReceipt(v2DineInJob, "cashier"));
  assert.equal(kitchen.includes("RM0.00"), false);
  assert.equal(cashier.includes("RM0.00"), false);
  assert.equal(kitchen.includes("+RM0.00"), false);
  assert.ok(kitchen.includes("牛油麻辣"));
});

test("charged modifier amount prints", () => {
  const kitchen = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  assert.ok(kitchen.includes("+ 加面 +RM2.00"));
});

test("multiple modifiers compact onto fewer lines", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  assert.ok(text.includes(" / "));
  const hotpotBlock = text.slice(text.indexOf("小火锅套餐"));
  const lines = hotpotBlock.split("\n").filter((line) => line.includes("鱼") || line.includes("菇") || line.includes("麻辣") || line.includes("面") || line.includes("火锅"));
  // Packed: fewer lines than one-per-modifier (6 modifiers).
  assert.ok(lines.length < 6);
});

test("Chinese width-aware wrapping works", () => {
  const wrapped = wrapByDisplayWidth("一二三四五六七八九十一二三四五六七八九十", 10);
  assert.ok(wrapped.length >= 4);
  for (const line of wrapped) {
    assert.ok(displayWidth(line) <= 10);
  }

  const packed = packSegments(
    ["牛油麻辣", "桌面自煮小火锅", "白鱼丸", "鲍鱼菇", "杏鲍菇", "唯一面"],
    { maxWidth: 32, indent: "  " },
  );
  assert.ok(packed.length >= 2);
  assert.ok(packed.length < 6);
  assert.ok(packed.some((line) => line.includes(" / ")));
});

test("DINE_IN displays compact table header", () => {
  const text = decode(buildOrderReceipt(v2DineInJob, "kitchen"));
  assert.ok(text.includes("堂食"));
  assert.ok(text.includes("桌1"));
  assert.ok(text.includes("#0004"));
  assert.ok(text.includes("【厨房联】"));
});

test("TAKEAWAY hides table", () => {
  const text = decode(buildOrderReceipt(v2TakeawayJob, "kitchen"));
  assert.ok(text.includes("外带"));
  assert.equal(text.includes("桌9"), false);
  assert.equal(text.includes("桌号"), false);
});

test("both copies still cut", () => {
  const buffer = buildJobReceipts(v2DineInJob);
  const text = decode(buffer);
  assert.ok(text.includes("【厨房联】"));
  assert.ok(text.includes("【收银联】"));
  assert.equal(countCuts(buffer), 2);
});

test("buildKitchenTestReceipt remains available for local hardware test", () => {
  const buffer = buildKitchenTestReceipt();
  const text = decode(buffer);
  assert.ok(text.includes("MJH-TEST-001"));
  assert.ok(text.includes("TCP 9100 TEST"));
});
