import type { OptionDetail, PrintJob, PrintJobItem, PrintJobPayload } from "../cloud/types.js";
import { minorToMoney, minorToMoneySpaced, minorToPlain } from "./money.js";
import * as escpos from "./escpos.js";

/**
 * Font A on 80mm / ~72mm printable ≈ 48 ASCII columns.
 * Chinese characters consume 2 columns.
 */
export const LINE_WIDTH = 48;
const SEPARATOR = "-".repeat(LINE_WIDTH);
const MODIFIER_INDENT = "  ";
/** Pre-cut feed lines — kitchen needs slightly more margin than cashier. */
export const FEED_BEFORE_CUT_KITCHEN = 4;
export const FEED_BEFORE_CUT_CASHIER = 3;

export type ReceiptCopy = "kitchen" | "cashier";

const COPY_SUBTITLE: Record<ReceiptCopy, string> = {
  kitchen: "【厨房联】",
  cashier: "【收银联】",
};

type ModifierView = {
  name: string;
  chargedAmount: number | null;
  fromOptionDetails: boolean;
};

function charWidth(char: string): number {
  return char.charCodeAt(0) > 0x7f ? 2 : 1;
}

/** Approximate display width (CJK ≈ 2 cols). */
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += charWidth(char);
  }
  return width;
}

export function truncateByDisplayWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  let result = "";
  let width = 0;
  for (const char of text) {
    const w = charWidth(char);
    if (width + w > maxWidth) {
      break;
    }
    result += char;
    width += w;
  }
  return result;
}

export function padRightByDisplayWidth(text: string, width: number): string {
  const current = displayWidth(text);
  if (current >= width) {
    return text;
  }
  return `${text}${" ".repeat(width - current)}`;
}

export function padLeftByDisplayWidth(text: string, width: number): string {
  const current = displayWidth(text);
  if (current >= width) {
    return text;
  }
  return `${" ".repeat(width - current)}${text}`;
}

/** Wrap text by display width without splitting code points incorrectly. */
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
  options: { maxWidth: number; separator?: string; indent?: string },
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

/** Derive #0010 from order number suffix when possible. */
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
      fromOptionDetails: true,
    }));
  }

  if (item.options && item.options.length > 0) {
    return item.options.map((name) => ({
      name,
      chargedAmount: null,
      fromOptionDetails: false,
    }));
  }

  return [];
}

/**
 * chargedAmount is authoritative.
 * chargedAmount > 0  => + name +RMx.xx
 * chargedAmount === 0 => + name  (never use standalonePrice)
 * options[] strings   => name only (packed)
 */
function formatModifierLabel(mod: ModifierView, currency: string): string {
  if (typeof mod.chargedAmount === "number" && mod.chargedAmount > 0) {
    return `+ ${mod.name} +${minorToMoney(mod.chargedAmount, currency)}`;
  }
  if (mod.fromOptionDetails) {
    return `+ ${mod.name}`;
  }
  return mod.name;
}

function modifierLines(item: PrintJobItem, currency: string): string[] {
  const mods = resolveModifiers(item);
  if (mods.length === 0) {
    return [];
  }

  const charged = mods.filter((m) => typeof m.chargedAmount === "number" && m.chargedAmount > 0);
  const free = mods.filter((m) => !(typeof m.chargedAmount === "number" && m.chargedAmount > 0));
  const lines: string[] = [];
  const contentWidth = LINE_WIDTH - displayWidth(MODIFIER_INDENT);

  for (const mod of charged) {
    const label = formatModifierLabel(mod, currency);
    for (const wrapped of wrapByDisplayWidth(label, contentWidth)) {
      lines.push(`${MODIFIER_INDENT}${wrapped}`);
    }
  }

  if (free.length > 0) {
    // optionDetails with chargedAmount 0 stay as individual "+ name" lines when few;
    // pack plain options[] and zero-charge details that share the free list.
    const fromDetails = free.filter((m) => m.fromOptionDetails);
    const fromOptions = free.filter((m) => !m.fromOptionDetails);

    for (const mod of fromDetails) {
      const label = formatModifierLabel(mod, currency);
      for (const wrapped of wrapByDisplayWidth(label, contentWidth)) {
        lines.push(`${MODIFIER_INDENT}${wrapped}`);
      }
    }

    if (fromOptions.length > 0) {
      const labels = fromOptions.map((m) => formatModifierLabel(m, currency));
      lines.push(
        ...packSegments(labels, {
          maxWidth: LINE_WIDTH,
          separator: " / ",
          indent: MODIFIER_INDENT,
        }),
      );
    }

    // Also pack zero-charge optionDetails when there are many (hotpot-style).
    if (fromDetails.length >= 2 && charged.length === 0 && fromOptions.length === 0) {
      lines.length = 0;
      const labels = fromDetails.map((m) => m.name);
      lines.push(
        ...packSegments(labels, {
          maxWidth: LINE_WIDTH,
          separator: " / ",
          indent: MODIFIER_INDENT,
        }),
      );
    }
  }

  return lines;
}

function hasNonEmptyNotes(notes: string | undefined): boolean {
  return typeof notes === "string" && notes.trim().length > 0;
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

function pushFooter(chunks: Buffer[], feedLines: number): void {
  // body → FEED → CUT (cutter needs blank margin under content)
  chunks.push(escpos.feed(feedLines));
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

function formatKitchenItemLine(item: PrintJobItem): string[] {
  const qty = `×${item.quantity}`;
  if (displayWidth(item.name) + 1 + displayWidth(qty) <= LINE_WIDTH) {
    return [padLeftRight(item.name, qty, LINE_WIDTH)];
  }
  return [
    ...wrapByDisplayWidth(item.name, LINE_WIDTH),
    padLeftByDisplayWidth(qty, LINE_WIDTH),
  ];
}

function formatCashierItemLines(item: PrintJobItem): string[] {
  const qtyUnit = `${item.quantity} × ${minorToPlain(item.unitPrice!)}`;
  const total = minorToPlain(item.lineTotal!);
  const compactRight = `${item.quantity}×${minorToPlain(item.unitPrice!)}  ${total}`;
  const compactRightWidth = displayWidth(compactRight);
  const nameBudget = LINE_WIDTH - compactRightWidth - 1;

  // Short names: single row
  if (nameBudget >= 4 && displayWidth(item.name) <= nameBudget) {
    return [padLeftRight(item.name, compactRight, LINE_WIDTH)];
  }

  // Long names: name, then qty×price ..... total
  const priceRow = padLeftRight(qtyUnit, total, LINE_WIDTH);
  return [...wrapByDisplayWidth(item.name, LINE_WIDTH), priceRow];
}

function pushKitchenV2(chunks: Buffer[], job: PrintJob): void {
  const { payload } = job;
  const currency = payload.currency ?? "MYR";

  pushMetaHeader(chunks, job);

  for (const item of payload.items) {
    for (const line of formatKitchenItemLine(item)) {
      chunks.push(escpos.lineGB18030(line));
    }

    for (const line of modifierLines(item, currency)) {
      chunks.push(escpos.lineGB18030(line));
    }

    if (hasNonEmptyNotes(item.notes)) {
      for (const line of wrapByDisplayWidth(`备注：${item.notes!.trim()}`, LINE_WIDTH)) {
        chunks.push(escpos.lineGB18030(line));
      }
    }
  }

  if (hasNonEmptyNotes(payload.notes)) {
    chunks.push(escpos.lineGB18030(SEPARATOR));
    for (const line of wrapByDisplayWidth(`备注：${payload.notes!.trim()}`, LINE_WIDTH)) {
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

    for (const line of modifierLines(item, currency)) {
      chunks.push(escpos.lineGB18030(line));
    }

    if (hasNonEmptyNotes(item.notes)) {
      for (const line of wrapByDisplayWidth(`备注：${item.notes!.trim()}`, LINE_WIDTH)) {
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

  if (hasNonEmptyNotes(payload.notes)) {
    for (const line of wrapByDisplayWidth(`备注：${payload.notes!.trim()}`, LINE_WIDTH)) {
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
    chunks.push(escpos.lineGB18030(padLeftRight(item.name, `×${item.quantity}`, LINE_WIDTH)));

    if (hasNonEmptyNotes(item.notes)) {
      chunks.push(escpos.lineGB18030(`备注：${item.notes!.trim()}`));
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

  if (hasNonEmptyNotes(payload.notes)) {
    chunks.push(escpos.lineGB18030(`备注：${payload.notes!.trim()}`));
  }
}

/** Single physical copy (kitchen or cashier). */
export function buildOrderReceipt(job: PrintJob, copy: ReceiptCopy): Buffer {
  const chunks: Buffer[] = [];
  pushTitle(chunks, COPY_SUBTITLE[copy]);

  if (isV2Payload(job.payload)) {
    if (copy === "kitchen") {
      pushKitchenV2(chunks, job);
    } else {
      pushCashierV2(chunks, job);
    }
  } else {
    pushV1Body(chunks, job);
  }

  const feedLines =
    copy === "kitchen" ? FEED_BEFORE_CUT_KITCHEN : FEED_BEFORE_CUT_CASHIER;
  pushFooter(chunks, feedLines);
  return Buffer.concat(chunks);
}

export function buildJobReceipts(job: PrintJob): Buffer {
  return Buffer.concat([buildOrderReceipt(job, "kitchen"), buildOrderReceipt(job, "cashier")]);
}

export function buildKitchenReceiptV2(job: PrintJob): Buffer {
  return buildOrderReceipt(job, "kitchen");
}

export function buildCashierReceiptV2(job: PrintJob): Buffer {
  return buildOrderReceipt(job, "cashier");
}

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
  chunks.push(escpos.lineGB18030(padLeftRight("担担面", "×1", LINE_WIDTH)));
  chunks.push(escpos.lineGB18030(padLeftRight("酸辣粉", "×2", LINE_WIDTH)));
  chunks.push(escpos.lineGB18030(padLeftRight("小火锅套餐", "×1", LINE_WIDTH)));
  chunks.push(escpos.lineGB18030("汤底：牛油麻辣"));
  chunks.push(escpos.lineGB18030("备注：少辣，不要香菜"));
  chunks.push(escpos.lineGB18030(SEPARATOR));
  chunks.push(escpos.lineGB18030("XP-N160II"));
  chunks.push(escpos.lineGB18030("TCP 9100 TEST"));

  pushFooter(chunks, FEED_BEFORE_CUT_KITCHEN);
  return Buffer.concat(chunks);
}
