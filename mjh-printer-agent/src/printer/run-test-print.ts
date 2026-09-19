/**
 * Shared hardware + V2 demo print used by CLI `printer:test` and Local API.
 * Does not duplicate ESC/POS builders — reuses receipt.ts.
 */
import { loadFileConfig } from "../config.js";
import { logger } from "../logger.js";
import { PrinterClient } from "./printer.js";
import {
  buildCashierReceiptV2,
  buildKitchenReceiptV2,
  buildKitchenTestReceipt,
} from "./receipt.js";
import type { PrintJob } from "../cloud/types.js";

function buildDemoPrintJob(): PrintJob {
  const now = new Date().toISOString();
  return {
    id: `demo_${Date.now()}`,
    orderId: `ord_demo_${Date.now()}`,
    type: "KITCHEN_ORDER",
    createdAt: now,
    payload: {
      fulfillmentType: "DINE_IN",
      table: "12",
      orderNumber: `MJH-DEMO-${Date.now().toString().slice(-6)}`,
      createdAt: now,
      currency: "MYR",
      notes: "少辣 / no coriander / extra chopsticks",
      items: [
        {
          name: "担担面 Dan Dan Noodles",
          quantity: 1,
          unitPrice: 1290,
          lineTotal: 1290,
          optionDetails: [{ name: "少辣", chargedAmount: 0 }],
        },
        {
          name: "Beef Rendang",
          quantity: 2,
          unitPrice: 1800,
          lineTotal: 3600,
          notes: "medium spicy",
        },
      ],
      subtotal: 4890,
      serviceCharge: 0,
      tax: 0,
      total: 4890,
    },
  };
}

export type RunTestPrintResult = {
  ok: boolean;
  message: string;
  printerIp: string;
  printerPort: number;
  printerModel: string;
};

export async function runTestPrint(): Promise<RunTestPrintResult> {
  const { printer } = loadFileConfig();
  const client = new PrinterClient(printer);

  try {
    await client.testConnection();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Printer offline: ${message}`,
      printerIp: printer.ip,
      printerPort: printer.port,
      printerModel: printer.model,
    };
  }

  try {
    await client.connect();
    await client.send(buildKitchenTestReceipt());
    const demo = buildDemoPrintJob();
    await client.send(buildKitchenReceiptV2(demo));
    await new Promise((r) => setTimeout(r, 400));
    await client.send(buildCashierReceiptV2(demo));
    return {
      ok: true,
      message: "Print jobs sent successfully (hardware + V2 demo)",
      printerIp: printer.ip,
      printerPort: printer.port,
      printerModel: printer.model,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[Printer] Print failed: ${message}`);
    return {
      ok: false,
      message: `Print failed: ${message}`,
      printerIp: printer.ip,
      printerPort: printer.port,
      printerModel: printer.model,
    };
  } finally {
    await client.close();
  }
}
