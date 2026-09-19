import { z } from "zod";

/** Cloud → Agent one-time pair payload (never forward token to Client). */
export const cloudPairResponseSchema = z.object({
  success: z.literal(true),
  storeName: z.string().min(1),
  agentName: z.string().min(1),
  storeId: z.string().min(1),
  agentId: z.string().min(1),
  token: z.string().min(8),
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
      body: JSON.stringify({ pairCode: options.pairCode.trim() }),
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
      let detail = text.slice(0, 200);
      if (typeof parsed === "object" && parsed && "error" in parsed) {
        detail = String((parsed as { error: unknown }).error);
      } else if (typeof parsed === "object" && parsed && "message" in parsed) {
        detail = String((parsed as { message: unknown }).message);
      }
      throw Object.assign(new Error(detail || `HTTP ${response.status}`), {
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
