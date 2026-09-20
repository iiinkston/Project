/** Local Control-Plane API DTOs — never include token / storeId / agentId. */

export const LOCAL_API_HOST = "127.0.0.1";
export const LOCAL_API_PORT = 17890;

export type LocalStatusResponse = {
  version: string;
  build: string;
  /** Always true when Local API answers. */
  running: true;
  pid: number;
  startedAt: string | null;
  updatedAt: string | null;
  /** Best-effort last cloud sync (poll / claim). */
  lastSyncAt: string | null;
  /** True when agent.token (or env token) is configured. */
  bound: boolean;
  /** Runtime lifecycle — Local API always up regardless. */
  lifecycle: "UNBOUND" | "BOUND_INITIALIZING" | "RUNNING" | "ERROR";
  storeName: string | null;
  cloud: {
    online: boolean;
  };
  printer: {
    model: string;
    ip: string;
    port: number;
    online: boolean;
  };
  queue: {
    pending: number;
  };
  worker: {
    lastPollAt: string | null;
    lastClaimAt: string | null;
    lastPrintAt: string | null;
    lastError: string | null;
  };
};

export type LocalUpdateCheckResponse = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  notes: string | null;
};

export type LocalLogsResponse = {
  logs: string[];
};

export type LocalDiscoverHit = {
  ip: string;
  port: number;
  reachable: true;
};

export type LocalDiscoverResponse = {
  subnet: string;
  scanned: number;
  printers: LocalDiscoverHit[];
};

export type LocalPrinterConfigBody = {
  ip: string;
  port?: number;
};

export type LocalBindBody = {
  /** Preferred. */
  code?: string;
  /** Legacy Client field. Used only when code is empty. */
  pairCode?: string;
};

export type LocalBindResponse = {
  success: true;
  storeName: string;
  agentName: string;
  /** True when worker started and cloud auth probe succeeded. */
  cloudOnline: boolean;
  printerOnline: boolean;
  lifecycle: "UNBOUND" | "BOUND_INITIALIZING" | "RUNNING" | "ERROR";
};

export type LocalOkResponse = {
  ok: true;
  message?: string;
};

export type LocalErrorResponse = {
  ok: false;
  error: string;
};
