import type { OptionDetail, PrintJob, PrintJobItem, PrintJobPayload } from "../cloud/types.js";
import { minorToMoney, minorToMoneySpaced, minorToPlain } from "./money.js";
import * as escpos from "./escpos.js";

const SEPARATOR = "--------------------------------";
/** Font A on 80mm ≈ 32 ASCII columns / 16 CJK cells with our current convention. */
export const LINE_WIDTH = 32;
const MODIFIER_INDENT = "  ";
const FEED_BEFORE_CUT = 2;

export type ReceiptCopy = "kitchen" | "cashier";

const COPY_SUBTITLE: Record<ReceiptCopy, string> = {
  kitchen: "【厨房联】",
  cashier: "【收银联】",
};

type ModifierView = {
  name: string;
  chargedAmount: number | null;
};

/** Approximate display width (CJK ≈ 2 cols). */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charWidth(char);
  }
  return width;
}

function charWidth(char: string): number {
  return char.charCodeAt(0) > 0x7f ? 2 : 1;
}

/** Wrap text by display width without splitting surrogate pairs incorrectly. */
export function wrapByDisplayWidth(text: string, maxWidth: number): string[] {
  if (maxWidth <= 0) {
    return [text];
  }

  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;

  for (const char of text) {
    const w = charWidth(char);
    if (currentWidth + w > maxWidth && current.length > 0) {
      lines.push(current);
      current = char;
      currentWidth = w;
    } else {
      current += char;
      currentWidth += w;
    }
  }

  if (current.length > 0 || lines.length === 0) {
    lines.push(current);
  }

  return lines;
}

/**
 * Pack short segments onto fewer lines using a separator.
 * Segments that alone exceed width are width-wrapped.
 */
export function packSegments(
  segments: string[],
  options: { maxWidth: number; separator?: string; indent?: string } ,
): string[] {
  const separator = options.separator ?? " / ";
  const indent = options.indent ?? "";
  const maxWidth = options.maxWidth;
  const contentWidth = Math.max(1, maxWidth - displayWidth(indent));
  const lines: string[] = [];
  let currentContent = "";

  const flush = () => {
    if (currentContent.length > 0) {
      lines.push(`${indent}${currentContent}`);
      currentContent = "";
    }
  };

  for (const segment of segments) {
    if (displayWidth(segment) > contentWidth) {
      flush();
      for (const part of wrapByDisplayWidth(segment, contentWidth)) {
        lines.push(`${indent}${part}`);
      }
      continue;
    }

    if (currentContent.length === 0) {
      currentContent = segment;
      continue;
    }

    const candidate = `${currentContent}${separator}${segment}`;
    if (displayWidth(candidate) <= contentWidth) {
      currentContent = candidate;
    } else {
      flush();
      currentContent = segment;
    }
  }

  flush();
  return lines;
}

function padItemLine(name: string, qty: string, totalWidth = LINE_WIDTH): string {
  const nameWidth = displayWidth(name);
  const qtyWidth = displayWidth(qty);
  const spaces = Math.max(1, totalWidth - nameWidth - qtyWidth);
  return `${name}${" ".repeat(spaces)}${qty}`;
}

function padLeftRight(left: string, right: string, totalWidth = LINE_WIDTH): string {
  const gap = Math.max(1, totalWidth - displayWidth(left) - displayWidth(right));
  return `${left}${" ".repeat(gap)}${right}`;
}

/** V2 when every item has unitPrice/lineTotal and payload has subtotal/total. */
export function isV2Payload(payload: PrintJobPayload): boolean {
  if (typeof payload.subtotal !== "number" || typeof payload.total !== "number") {
    return false;
  }

  return payload.items.every(
    (item) => typeof item.unitPrice === "number" && typeof item.lineTotal === "number",
  );
}

/** Temporary diagnostics for production claim payloads. */
export function logPayloadDetection(payload: PrintJobPayload): boolean {
  const v2 = isV2Payload(payload);
  console.log("[Receipt] payload keys:", Object.keys(payload));
  console.log("[Receipt] detected V2:", v2);
  console.log(
    "[Receipt] money fields:",
    JSON.stringify({
      subtotal: payload.subtotal,
      total: payload.total,
      currency: payload.currency,
      fulfillmentType: payload.fulfillmentType,
      itemMoney: payload.items.map((item) => ({
        name: item.name,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
        unitPriceType: typeof item.unitPrice,
        lineTotalType: typeof item.lineTotal,
      })),
    }),
  );
  return v2;
}

export function formatReceiptTime(iso: string | undefined, fallbackIso: string): string {
  const raw = iso && iso.length > 0 ? iso : fallbackIso;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  const hh = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${hh}:${min}`;
}

/** Derive #0004 from order number suffix when possible. */
export function shortOrderTag(orderNumber: string): string {
  const match = orderNumber.match(/(\d+)$/);
  if (!match) {
    return orderNumber;
  }
  const digits = match[1] ?? orderNumber;
  return `#${digits.slice(-4).padStart(4, "0")}`;
}

function fulfillmentLabel(type: PrintJobPayload["fulfillmentType"]): string | undefined {
  if (type === "DINE_IN") {
    return "堂食";
  }
  if (type === "TAKEAWAY") {
    return "外带";
  }
  return undefined;
}

function resolveModifiers(item: PrintJobItem): ModifierView[] {
  if (item.optionDetails && item.optionDetails.length > 0) {
    return item.optionDetails.map((detail: OptionDetail) => ({
      name: detail.name,
      chargedAmount:
        typeof detail.chargedAmount === "number" ? detail.chargedAmount : null,
    }));
  }

  if (item.options && item.options.length > 0) {
    return item.options.map((name) => ({ name, chargedAmount: null }));
  }

  return [];
}

function formatModifierLabel(mod: ModifierView, currency: string, showCharge: boolean): string {
  if (showCharge && typeof mod.chargedAmount === "number" && mod.chargedAmount > 0) {
    return `+ ${mod.name} +${minorToMoney(mod.chargedAmount, currency)}`;
  }
  if (typeof mod.chargedAmount === "number" && mod.chargedAmount > 0) {
    return `+ ${mod.name}`;
  }
  return mod.name;
}

function modifierLines(
  item: PrintJobItem,
  currency: string,
  showCharge: boolean,
): string[] {
  const mods = resolveModifiers(item);
  if (mods.length === 0) {
    return [];
  }

  const charged = mods.filter((m) => typeof m.chargedAmount === "number" && m.chargedAmount > 0);
  const free = mods.filter((m) => !(typeof m.chargedAmount === "number" && m.chargedAmount > 0));

  const lines: string[] = [];

  for (const mod of charged) {
    const label = formatModifierLabel(mod, currency, showCharge);
    for (const wrapped of wrapByDisplayWidth(label, LINE_WIDTH - displayWidth(MODIFIER_INDENT))) {
      lines.push(`${MODIFIER_INDENT}${wrapped}`);
    }
  }

  if (free.length > 0) {
    const labels = free.map((m) => formatModifierLabel(m, currency, false));
    lines.push(
      ...packSegments(labels, {
        maxWidth: LINE_WIDTH,
        separator: " / ",
        indent: MODIFIER_INDENT,
      }),
    );
  }

  return lines;
}

function pushTitle(chunks: Buffer[], subtitle: string): void {
  chunks.push(escpos.initialize());
  chunks.push(escpos.alignCenter());
  chunks.push(escpos.boldOn());
  chunks.push(escpos.doubleSize());
  chunks.push(escpos.lineGB18030("满江红"));
  chunks.push(escpos.normalSize());
  chunks.push(escpos.boldOff());
  chunks.push(escpos.lineGB18030(subtitle));
}

function pushFooter(chunks: Buffer[]): void {
  chunks.push(escpos.feed(FEED_BEFORE_CUT));
  chunks.push(escpos.fullCut());
}

function pushMetaHeader(chunks: Buffer[], job: PrintJob): void {
  const { payload } = job;
  const parts: string[] = [];
  const label = fulfillmentLabel(payload.fulfillmentType);
  if (label) {
    parts.push(label);
  }

  if (payload.fulfillmentType !== "TAKEAWAY" && payload.table) {
    parts.push(`桌${payload.table}`);
  }

  parts.push(shortOrderTag(payload.orderNumber));
  parts.push(formatReceiptTime(payload.createdAt, job.createdAt));

  chunks.push(escpos.alignLeft());
  chunks.push(escpos.lineGB18030(SEPARATOR));
  chunks.push(escpos.lineGB18030(parts.join("  ")));
  chunks.push(escpos.lineGB18030(payload.orderNumber));
  chunks.push(escpos.lineGB18030(SEPARATOR));
}

function formatCashierItemLines(item: PrintJobItem): string[] {
  const qtyUnit = `${item.quantity}×${minorToPlain(item.unitPrice!)}`;
  const total = minorToPlain(item.lineTotal!);
  const right = `${qtyUnit}  ${total}`;
  const rightWidth = displayWidth(right);
  const nameBudget = LINE_WIDTH - rightWidth - 1;

  if (nameBudget >= 2 && displayWidth(item.name) <= nameBudget) {
    return [padLeftRight(item.name, right, LINE_WIDTH)];
  }

  const nameLines = wrapByDisplayWidth(item.name, LINE_WIDTH);
  const priceLine = `${" ".repeat(Math.max(0, LINE_WIDTH - rightWidth))}${right}`;
  return [...nameLines, priceLine];
}

function pushKitchenV2(chunks: Buffer[], job: PrintJob): void {
  const { payload } = job;
  const currency = payload.currency ?? "MYR";

  pushMetaHeader(chunks, job);

  for (let index = 0; index < payload.items.length; index += 1) {
    const item = payload.items[index]!;
    const nameQty = `${item.name} ×${item.quantity}`;
    for (const line of wrapByDisplayWidth(nameQty, LINE_WIDTH)) {
      chunks.push(escpos.lineGB18030(line));
    }

    const mods = modifierLines(item, currency, true);
    for (const line of mods) {
      chunks.push(escpos.lineGB18030(line));
    }

    if (item.notes) {
      for (const line of wrapByDisplayWidth(`备注：${item.notes}`, LINE_WIDTH)) {
        chunks.push(escpos.lineGB18030(line));
      }
    }

    const hasDetail = mods.length > 0 || Boolean(item.notes);
    const next = payload.items[index + 1];
    if (hasDetail && next) {
      chunks.push(escpos.lineGB18030());
    }
  }

  if (payload.notes) {
    chunks.push(escpos.lineGB18030(SEPARATOR));
    for (const line of wrapByDisplayWidth(`备注：${payload.notes}`, LINE_WIDTH)) {
      chunks.push(escpos.lineGB18030(line));
    }
  }
}

function pushCashierV2(chunks: Buffer[], job: PrintJob): void {
  const { payload } = job;
  const currency = payload.currency ?? "MYR";

  pushMetaHeader(chunks, job);

  for (const item of payload.items) {
    for (const line of formatCashierItemLines(item)) {
      chunks.push(escpos.lineGB18030(line));
    }

    for (const line of modifierLines(item, currency, true)) {
      chunks.push(escpos.lineGB18030(line));
    }

    if (item.notes) {
      for (const line of wrapByDisplayWidth(`备注：${item.notes}`, LINE_WIDTH)) {
        chunks.push(escpos.lineGB18030(line));
      }
    }
  }

  chunks.push(escpos.lineGB18030(SEPARATOR));
  chunks.push(escpos.lineGB18030(padLeftRight("小计", minorToPlain(payload.subtotal!), LINE_WIDTH)));

  if (typeof payload.serviceCharge === "number" && payload.serviceCharge > 0) {
    chunks.push(
      escpos.lineGB18030(padLeftRight("服务费", minorToPlain(payload.serviceCharge), LINE_WIDTH)),
    );
  }

  if (typeof payload.tax === "number" && payload.tax > 0) {
    chunks.push(escpos.lineGB18030(padLeftRight("税费", minorToPlain(payload.tax), LINE_WIDTH)));
  }

  chunks.push(escpos.boldOn());
  chunks.push(
    escpos.lineGB18030(padLeftRight("合计", minorToMoneySpaced(payload.total!, currency), LINE_WIDTH)),
  );
  chunks.push(escpos.boldOff());
  chunks.push(escpos.lineGB18030(SEPARATOR));

  if (payload.notes) {
    for (const line of wrapByDisplayWidth(`备注：${payload.notes}`, LINE_WIDTH)) {
      chunks.push(escpos.lineGB18030(line));
    }
  }
}

function pushV1Body(chunks: Buffer[], job: PrintJob): void {
  const { payload } = job;

  chunks.push(escpos.alignLeft());
  chunks.push(escpos.lineGB18030(SEPARATOR));
  if (payload.table) {
    chunks.push(escpos.lineGB18030(`桌号：${payload.table}`));
  }
  chunks.push(escpos.lineGB18030(`订单号：${payload.orderNumber}`));
  chunks.push(escpos.lineGB18030(SEPARATOR));

  for (const item of payload.items) {
    chunks.push(escpos.lineGB18030(padItemLine(item.name, `×${item.quantity}`)));

    if (item.notes) {
      chunks.push(escpos.lineGB18030(`备注：${item.notes}`));
    }

    if (item.options && item.options.length > 0) {
      for (const line of packSegments(item.options, {
        maxWidth: LINE_WIDTH,
        separator: " / ",
        indent: MODIFIER_INDENT,
      })) {
        chunks.push(escpos.lineGB18030(line));
      }
    }
  }

  chunks.push(escpos.lineGB18030(SEPARATOR));

  if (payload.notes) {
    chunks.push(escpos.lineGB18030(`备注：${payload.notes}`));
  }
}

/** Single physical copy (kitchen or cashier). */
export function buildOrderReceipt(job: PrintJob, copy: ReceiptCopy): Buffer {
  const chunks: Buffer[] = [];
  pushTitle(chunks, COPY_SUBTITLE[copy]);

  const v2 = isV2Payload(job.payload);
  if (v2) {
    if (copy === "kitchen") {
      console.log("[Receipt] renderer: pushKitchenV2");
      pushKitchenV2(chunks, job);
    } else {
      console.log("[Receipt] renderer: pushCashierV2");
      pushCashierV2(chunks, job);
    }
  } else {
    console.log("[Receipt] renderer: pushV1Body (legacy fallback)");
    pushV1Body(chunks, job);
  }

  pushFooter(chunks);
  return Buffer.concat(chunks);
}

/**
 * Local dual-copy print buffer for one cloud PrintJob.
 * Prefer sending kitchen/cashier separately at runtime (see PrintWorker).
 */
export function buildJobReceipts(job: PrintJob): Buffer {
  return Buffer.concat([buildOrderReceipt(job, "kitchen"), buildOrderReceipt(job, "cashier")]);
}

/** V2-capable kitchen copy (falls back to V1 layout when payload is legacy). */
export function buildKitchenReceiptV2(job: PrintJob): Buffer {
  return buildOrderReceipt(job, "kitchen");
}

/** V2-capable cashier copy (falls back to V1 layout when payload is legacy). */
export function buildCashierReceiptV2(job: PrintJob): Buffer {
  return buildOrderReceipt(job, "cashier");
}

/** Kitchen copy only. */
export function buildKitchenReceipt(job: PrintJob): Buffer {
  return buildKitchenReceiptV2(job);
}

/** Local hardware validation receipt used by `pnpm printer:test`. */
export function buildKitchenTestReceipt(): Buffer {
  const chunks: Buffer[] = [];

  pushTitle(chunks, "【厨房联】");

  chunks.push(escpos.alignLeft());
  chunks.push(escpos.lineGB18030(SEPARATOR));
  chunks.push(escpos.lineGB18030("桌号：01"));
  chunks.push(escpos.lineGB18030("订单号：MJH-TEST-001"));
  chunks.push(escpos.lineGB18030(SEPARATOR));
  chunks.push(escpos.lineGB18030(padItemLine("担担面", "×1")));
  chunks.push(escpos.lineGB18030(padItemLine("酸辣粉", "×2")));
  chunks.push(escpos.lineGB18030(padItemLine("小火锅套餐", "×1")));
  chunks.push(escpos.lineGB18030("汤底：牛油麻辣"));
  chunks.push(escpos.lineGB18030("备注：少辣，不要香菜"));
  chunks.push(escpos.lineGB18030(SEPARATOR));
  chunks.push(escpos.lineGB18030("XP-N160II"));
  chunks.push(escpos.lineGB18030("TCP 9100 TEST"));

  pushFooter(chunks);
  return Buffer.concat(chunks);
}
