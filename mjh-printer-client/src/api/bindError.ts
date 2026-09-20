/** Cloud / Agent error bodies. Never String(object) — that becomes "[object Object]". */

function readMessage(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    return text && text !== "[object Object]" ? text : "";
  }
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      const text = message.trim();
      if (text && text !== "[object Object]") return text;
    }
  }
  return "";
}

function redactSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactSecrets);
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = /token/i.test(key) ? "***" : redactSecrets(child);
  }
  return out;
}

export function extractApiErrorMessage(parsed: unknown): string {
  if (typeof parsed === "string") return readMessage(parsed);
  if (!parsed || typeof parsed !== "object") return "";

  const record = parsed as Record<string, unknown>;
  const fromError = readMessage(record.error);
  if (fromError) return fromError;
  const top = readMessage(record);
  if (top) return top;

  try {
    return JSON.stringify(redactSecrets(parsed));
  } catch {
    return "";
  }
}

/** User-facing bind failure. Technical text is logged separately. */
export function userBindMessage(technical: string): string {
  if (/PAIRING_CODE_INVALID|invalid pairing code/i.test(technical)) {
    return "注册码无效，请检查后重试";
  }
  const text = technical.trim();
  if (!text || text === "[object Object]") return "绑定失败，请稍后重试";
  return text;
}

/** POST /local/bind body. Long-lived store code only — never pairCode. */
export function bindRequestBody(code: string): { code: string } {
  return { code: code.trim() };
}
