/** Read a Cloud error body without turning objects into "[object Object]". Never includes token. */

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = /token/i.test(key) ? "***" : redactSecrets(child);
    }
    return out;
  }
  return value;
}

export function extractApiErrorMessage(parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as { error?: unknown; message?: unknown };
    const err = record.error;
    if (err && typeof err === "object" && "message" in err) {
      const message = (err as { message?: unknown }).message;
      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    }
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (typeof err === "string" && err.trim() && err !== "[object Object]") {
      return err.trim();
    }
    if (err !== undefined) {
      return JSON.stringify(redactSecrets(err));
    }
  }
  if (typeof parsed === "string" && parsed.trim()) {
    return parsed.trim();
  }
  return JSON.stringify(redactSecrets(parsed));
}
