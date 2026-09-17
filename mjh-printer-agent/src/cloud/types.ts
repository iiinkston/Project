import { z } from "zod";

export const PrintJobStatus = {
  PENDING: "PENDING",
  CLAIMED: "CLAIMED",
  PRINTING: "PRINTING",
  PRINTED: "PRINTED",
  FAILED: "FAILED",
} as const;

export type PrintJobStatus = (typeof PrintJobStatus)[keyof typeof PrintJobStatus];

/** Accept JSON numbers or numeric strings from Prisma/Nest serializers. */
const moneyInt = z.union([
  z.number().int(),
  z
    .string()
    .regex(/^-?\d+$/, "expected integer string")
    .transform((value) => Number.parseInt(value, 10)),
]);

const moneyIntOptional = moneyInt.optional();
const moneyIntNullableOptional = moneyInt.nullable().optional();

export const optionDetailSchema = z.object({
  name: z.string().min(1),
  groupName: z.string().optional(),
  chargedAmount: moneyIntNullableOptional,
  standalonePrice: moneyIntNullableOptional,
  bundleSurcharge: moneyIntNullableOptional,
  isOverage: z.boolean().optional(),
});

export const printJobItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.union([
    z.number().int().positive(),
    z
      .string()
      .regex(/^\d+$/)
      .transform((value) => Number.parseInt(value, 10)),
  ]),
  notes: z.string().optional(),
  options: z.array(z.string()).optional(),
  unitPrice: moneyIntOptional,
  lineTotal: moneyIntOptional,
  optionDetails: z.array(optionDetailSchema).optional(),
});

export const printJobPayloadSchema = z.object({
  fulfillmentType: z.enum(["DINE_IN", "TAKEAWAY"]).optional(),
  table: z.union([z.string(), z.number().transform((n) => String(n))]).optional(),
  orderNumber: z.string().min(1),
  createdAt: z.string().optional(),
  currency: z.string().optional(),
  items: z.array(printJobItemSchema).min(1),
  notes: z.string().optional(),
  subtotal: moneyIntOptional,
  serviceCharge: moneyIntOptional,
  tax: moneyIntOptional,
  total: moneyIntOptional,
});

export const printJobSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  type: z.literal("KITCHEN_ORDER"),
  createdAt: z.string().min(1),
  payload: printJobPayloadSchema,
});

export type OptionDetail = z.infer<typeof optionDetailSchema>;
export type PrintJobItem = z.infer<typeof printJobItemSchema>;
export type PrintJobPayload = z.infer<typeof printJobPayloadSchema>;
export type PrintJob = z.infer<typeof printJobSchema>;

export const claimJobResponseSchema = z.object({
  job: printJobSchema.nullable(),
});

export type ClaimJobResponse = z.infer<typeof claimJobResponseSchema>;
