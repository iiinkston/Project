import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { logger } from "../logger.js";
import {
  handleLocalBind,
  handleLocalLogs,
  handleLocalStatus,
  handleLocalUpdate,
  handleLocalUpdateApply,
  handleLocalUpdateCheck,
  handleLocalUpdateDownload,
  handleLocalUpdateStatus,
  handlePrinterConfig,
  handlePrinterDiscover,
  handlePrinterTest,
  parseJsonBody,
} from "./router.js";
import {
  LOCAL_API_HOST,
  LOCAL_API_PORT,
  type LocalBindBody,
  type LocalPrinterConfigBody,
} from "./types.js";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  // Defense-in-depth: never emit token-like keys
  if (/"token"\s*:/i.test(payload) || /"storeId"\s*:/i.test(payload) || /"agentId"\s*:/i.test(payload)) {
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "internal response blocked" }));
    return;
  }
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit = 64_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:*");
  // Browsers don't support wildcard ports in ACAO; Electron loads file/localhost — allow common origins.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export type LocalHttpServer = {
  server: Server;
  host: string;
  port: number;
  close: () => Promise<void>;
};

/**
 * Control-plane HTTP for Electron Client.
 * Binds ONLY to 127.0.0.1 — never 0.0.0.0.
 */
export async function startLocalHttpServer(options?: {
  host?: string;
  port?: number;
}): Promise<LocalHttpServer> {
  const host = options?.host ?? LOCAL_API_HOST;
  const port = options?.port ?? LOCAL_API_PORT;

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Local API must bind to localhost, got ${host}`);
  }

  const server = createServer(async (req, res) => {
    cors(res);
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${host}:${port}`);
    const path = url.pathname;

    try {
      if (req.method === "GET" && path === "/local/status") {
        sendJson(res, 200, await handleLocalStatus());
        return;
      }
      if (req.method === "GET" && path === "/local/logs") {
        const lines = url.searchParams.get("lines") ?? url.searchParams.get("limit");
        sendJson(res, 200, await handleLocalLogs(lines ? Number(lines) : 100));
        return;
      }
      if (req.method === "POST" && path === "/local/printer/test") {
        const result = await handlePrinterTest();
        sendJson(res, result.ok ? 200 : 502, result);
        return;
      }
      if (req.method === "POST" && path === "/local/printer/discover") {
        sendJson(res, 200, await handlePrinterDiscover());
        return;
      }
      if (req.method === "POST" && path === "/local/printer/config") {
        const raw = await readBody(req);
        const body = parseJsonBody<LocalPrinterConfigBody>(raw);
        const result = await handlePrinterConfig(body);
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "POST" && path === "/local/bind") {
        const raw = await readBody(req);
        const body = parseJsonBody<LocalBindBody>(raw);
        const result = await handleLocalBind(body);
        const ok = "success" in result && result.success === true;
        sendJson(res, ok ? 200 : 400, result);
        return;
      }
      if (req.method === "GET" && path === "/local/health") {
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && path === "/local/update/check") {
        sendJson(res, 200, await handleLocalUpdateCheck());
        return;
      }
      if (req.method === "GET" && path === "/local/update/status") {
        sendJson(res, 200, handleLocalUpdateStatus());
        return;
      }
      if (req.method === "POST" && path === "/local/update/download") {
        const result = await handleLocalUpdateDownload();
        sendJson(res, result.ok ? 200 : 400, result);
        return;
      }
      if (req.method === "POST" && path === "/local/update/apply") {
        const result = handleLocalUpdateApply();
        sendJson(res, result.ok ? 202 : 400, result);
        return;
      }
      if (req.method === "POST" && path === "/local/update") {
        const result = handleLocalUpdate();
        sendJson(res, result.ok ? 202 : 400, result);
        return;
      }

      sendJson(res, 404, { ok: false, error: `Not found: ${path}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[LocalAPI] ${req.method} ${path} → ${message}`);
      sendJson(res, 500, { ok: false, error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  logger.info(`[LocalAPI] listening on http://${host}:${port}`, "STARTUP");

  return {
    server,
    host,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
