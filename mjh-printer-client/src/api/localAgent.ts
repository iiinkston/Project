import { bindRequestBody, extractApiErrorMessage, userBindMessage } from "./bindError";

export const LOCAL_AGENT_BASE = "http://127.0.0.1:17890";

export type LocalStatus = {
  version: string;
  build: string;
  running: true;
  pid: number;
  startedAt: string | null;
  updatedAt: string | null;
  lastSyncAt: string | null;
  bound: boolean;
  storeName: string | null;
  cloud: { online: boolean };
  printer: {
    model: string;
    ip: string;
    port: number;
    online: boolean;
  };
  queue: { pending: number };
  worker: {
    lastPollAt: string | null;
    lastClaimAt: string | null;
    lastPrintAt: string | null;
    lastError: string | null;
  };
};

export type UpdateCheck = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  notes: string | null;
};

export type DiscoverHit = {
  ip: string;
  port: number;
  reachable: true;
};

export type BindResult = {
  success: true;
  storeName: string;
  agentName: string;
};

function logTechnical(scope: string, message: string): void {
  const safe = message.replace(/("token"\s*:\s*")[^"]*"/gi, '$1***').slice(0, 400);
  void window.mjhDesktop?.log?.(`${scope} ${safe}`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${LOCAL_AGENT_BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body: unknown = undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`Agent 返回非 JSON (${res.status})`);
  }
  if (!res.ok) {
    const technical = extractApiErrorMessage(body) || text.slice(0, 200) || `HTTP ${res.status}`;
    if (path === "/local/bind") {
      logTechnical("bind failed", technical);
      throw new Error(userBindMessage(technical));
    }
    throw new Error(technical === "[object Object]" ? `HTTP ${res.status}` : technical);
  }
  return body as T;
}

export const localAgent = {
  health: () => request<{ ok: boolean }>("/local/health"),
  status: () => request<LocalStatus>("/local/status"),
  logs: (lines = 100) =>
    request<{ logs: string[] }>(`/local/logs?lines=${lines}`),
  bind: (code: string) =>
    request<BindResult>("/local/bind", {
      method: "POST",
      body: JSON.stringify(bindRequestBody(code)),
    }),
  testPrint: () =>
    request<{ ok: boolean; message?: string; error?: string }>("/local/printer/test", {
      method: "POST",
      body: "{}",
    }),
  discover: () =>
    request<{ subnet: string; scanned: number; printers: DiscoverHit[] }>(
      "/local/printer/discover",
      { method: "POST", body: "{}" },
    ),
  setPrinter: (ip: string, port = 9100) =>
    request<{ ok: boolean; message?: string; error?: string }>("/local/printer/config", {
      method: "POST",
      body: JSON.stringify({ ip, port }),
    }),
  checkUpdate: () => request<UpdateCheck>("/local/update/check"),
  applyUpdate: () =>
    request<{ ok: boolean; message?: string; error?: string }>("/local/update", {
      method: "POST",
      body: "{}",
    }),
};
