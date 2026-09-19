#!/usr/bin/env node
/**
 * Local mock Cloud pairing server for Agent E2E without production DB.
 * POST http://127.0.0.1:3099/api/v1/printer/pair
 * Body: { "pairCode": "MJH-KL-001" }
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.MJH_PAIR_MOCK_PORT || 3099);
const STORE = join(__dirname, "mock-store.json");

const DEFAULT = {
  codes: {
    "MJH-KL-001": {
      storeId: "cmu82urxz0000pifptl0yiq9b",
      storeName: "满江红",
      agentId: "kitchen-1",
      used: false,
    },
  },
};

function load() {
  if (!existsSync(STORE)) {
    mkdirSync(dirname(STORE), { recursive: true });
    writeFileSync(STORE, JSON.stringify(DEFAULT, null, 2));
    return structuredClone(DEFAULT);
  }
  return JSON.parse(readFileSync(STORE, "utf8"));
}

function save(data) {
  writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function hash(token) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (req.method === "GET" && url.pathname === "/api/v1/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "mjh-pair-mock" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/v1/printer/pair") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
      return;
    }

    const pairCode = String(body.pairCode || "").trim().toUpperCase();
    const db = load();
    const row = db.codes[pairCode];
    if (!row) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Invalid pair code" }));
      return;
    }
    if (row.used) {
      res.writeHead(409, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "Pair code already used" }));
      return;
    }

    const token = randomBytes(32).toString("base64");
    row.used = true;
    row.tokenHashPrefix = hash(token).slice(0, 8);
    save(db);

    // Never log token
    console.log(`[pair-mock] paired code=${pairCode} hashPrefix=${row.tokenHashPrefix}`);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        storeName: row.storeName,
        agentName: row.agentId,
        storeId: row.storeId,
        agentId: row.agentId,
        token,
      }),
    );
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ success: false, error: `Not found ${url.pathname}` }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[pair-mock] http://127.0.0.1:${PORT}/api/v1/printer/pair`);
  console.log(`[pair-mock] preset code MJH-KL-001 (one-time per store file)`);
});
