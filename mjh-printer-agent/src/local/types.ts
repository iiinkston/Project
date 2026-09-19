/** Local Control-Plane API DTOs — never include token / storeId / agentId. */

export const LOCAL_API_HOST = "127.0.0.1";
export const LOCAL_API_PORT = 17890;

export type LocalStatusResponse = {
  version: string;
  build: string;
  pid: number;
  startedAt: string | null;
  updatedAt: string | null;
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

export type LocalOkResponse = {
  ok: true;
  message?: string;
};

export type LocalErrorResponse = {
  ok: false;
  error: string;
};
