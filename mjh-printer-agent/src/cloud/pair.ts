import { z } from "zod";
import { extractApiErrorMessage } from "./api-error.js";

/** Cloud → Agent one-time pair payload (never forward token to Client). */
/**
 * Production Cloud currently returns storeName/storeId/agentKey/token
 * without success/agentName/agentId. Accept both shapes.
 */
export const cloudPairResponseSchema = z
  .object({
    success: z.literal(true).optional(),
    storeName: z.string().min(1),
    agentName: z.string().min(1).optional(),
    storeId: z.string().min(1),
    agentId: z.string().min(1).optional(),
    agentKey: z.string().min(1).optional(),
    token: z.string().min(8),
  })
  .transform((value) => {
    const agentId = value.agentId || value.agentKey;
    if (!agentId) {
      throw new Error("pair response missing agent id");
    }
    return {
      success: true as const,
      storeName: value.storeName,
      agentName: value.agentName || agentId,
      storeId: value.storeId,
      agentId,
      token: value.token,
    };
  });

export type CloudPairResponse = z.infer<typeof cloudPairResponseSchema>;

export type CloudPairError = {
  success: false;
  error: string;
  status: number;
};

/**
 * Call Cloud pairing API. No Bearer header (unbound agent).
 * Never log plaintext token.
 */
export async function pairWithCloud(options: {
  baseUrl: string;
  pairCode: string;
  requestTimeoutMs?: number;
}): Promise<CloudPairResponse> {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const url = `${baseUrl}/printer/pair`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 15_000);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ code: options.pairCode.trim() }),
      signal: controller.signal,
    });

    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      throw Object.assign(new Error(`Cloud returned non-JSON (HTTP ${response.status})`), {
        status: response.status,
      });
    }

    if (!response.ok) {
      throw Object.assign(new Error(extractApiErrorMessage(parsed)), {
        status: response.status,
      });
    }

    const ok = cloudPairResponseSchema.safeParse(parsed);
    if (!ok.success) {
      throw Object.assign(new Error("Invalid pair response from cloud"), { status: 502 });
    }
    return ok.data;
  } finally {
    clearTimeout(timer);
  }
}
