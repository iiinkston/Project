/**
 * NestJS-oriented pair service (copy into apps/api).
 * Do NOT log plaintext token or pairCode.
 */
import { createHash, randomBytes } from "node:crypto";

export type PairResult = {
  success: true;
  storeName: string;
  agentName: string;
  storeId: string;
  agentId: string;
  token: string;
};

export function hashTokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function generateAgentToken(): string {
  return randomBytes(32).toString("base64");
}

/**
 * Pseudo-code steps for Prisma transaction:
 * 1. Find pair code WHERE code = pairCode AND used_at IS NULL
 * 2. If missing / expired → throw 404/400
 * 3. Generate token + token_hash
 * 4. Upsert printer_agents (restaurant_id, agent_key, token_hash)
 * 5. SET used_at = NOW() on pair code (one-time)
 * 6. Return PairResult (token once)
 */
export async function pairPrinterAgent(_deps: {
  findCode: (code: string) => Promise<{
    id: string;
    restaurantId: string;
    agentKey: string;
    storeName: string;
    usedAt: Date | null;
    expiresAt: Date | null;
  } | null>;
  markUsed: (id: string) => Promise<void>;
  upsertAgent: (input: {
    restaurantId: string;
    agentKey: string;
    tokenHash: string;
  }) => Promise<void>;
  pairCode: string;
}): Promise<PairResult> {
  const code = _deps.pairCode.trim().toUpperCase();
  if (!code) {
    throw Object.assign(new Error("pairCode required"), { status: 400 });
  }

  const row = await _deps.findCode(code);
  if (!row) {
    throw Object.assign(new Error("Invalid pair code"), { status: 404 });
  }
  if (row.usedAt) {
    throw Object.assign(new Error("Pair code already used"), { status: 409 });
  }
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw Object.assign(new Error("Pair code expired"), { status: 400 });
  }

  const token = generateAgentToken();
  const tokenHash = hashTokenSha256(token);

  await _deps.upsertAgent({
    restaurantId: row.restaurantId,
    agentKey: row.agentKey,
    tokenHash,
  });
  await _deps.markUsed(row.id);

  return {
    success: true,
    storeName: row.storeName,
    agentName: row.agentKey,
    storeId: row.restaurantId,
    agentId: row.agentKey,
    token,
  };
}
