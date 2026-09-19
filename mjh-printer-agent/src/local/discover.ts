import { createConnection } from "node:net";
import { networkInterfaces } from "node:os";
import type { LocalDiscoverHit, LocalDiscoverResponse } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pick a primary IPv4 (non-internal) for subnet scanning. */
export function resolveLanIpv4(): string | null {
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const e of entries) {
      if (e.family === "IPv4" && !e.internal) {
        return e.address;
      }
    }
  }
  // Fallback loopback-only environments (CI)
  return "127.0.0.1";
}

export function subnetPrefix(ipv4: string): string {
  const parts = ipv4.split(".");
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4: ${ipv4}`);
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

function probeTcp(ip: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: ip, port });
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

/**
 * Scan current /24 for TCP 9100 (kitchen ESC/POS).
 * Concurrency-limited; skips self optional.
 */
export async function discoverPrinters9100(options?: {
  port?: number;
  timeoutMs?: number;
  concurrency?: number;
  ipv4?: string;
}): Promise<LocalDiscoverResponse> {
  const port = options?.port ?? 9100;
  const timeoutMs = options?.timeoutMs ?? 350;
  const concurrency = options?.concurrency ?? 32;
  const ipv4 = options?.ipv4 ?? resolveLanIpv4() ?? "127.0.0.1";
  const prefix = subnetPrefix(ipv4);

  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    hosts.push(`${prefix}.${i}`);
  }

  const printers: LocalDiscoverHit[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < hosts.length) {
      const i = index++;
      const ip = hosts[i]!;
      const ok = await probeTcp(ip, port, timeoutMs);
      if (ok) {
        printers.push({ ip, port, reachable: true });
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  // Stable order by last octet
  printers.sort((a, b) => {
    const aa = Number(a.ip.split(".").pop());
    const bb = Number(b.ip.split(".").pop());
    return aa - bb;
  });

  // Tiny yield so event loop stays responsive after burst
  await sleep(0);

  return {
    subnet: `${prefix}.0/24`,
    scanned: hosts.length,
    printers,
  };
}
