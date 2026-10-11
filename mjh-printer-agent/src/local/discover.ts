import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { logger } from "../logger.js";
import type { LocalDiscoverHit, LocalDiscoverResponse, LanDiagnostics } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Virtual / tunnel / hypervisor adapters — never use for kitchen LAN scan. */
const EXCLUDE_IFACE_RE =
  /loopback|isatap|teredo|vethernet|hyper-?v|docker|wsl|veth|br-|virbr|vmware|virtualbox|vboxnet|zerotier|tailscale|hamachi|tap-windows|wintun|wireguard|nordlynx|cisco anyconnect|vpn|openvpn|softether|radmin vpn/i;

/** Prefer real Ethernet / Wi-Fi when ranking candidates. */
const PREFER_IFACE_RE = /wi-?fi|wlan|wireless|ethernet|本地连接|以太网|无线/i;

export type LanCandidate = { name: string; address: string };

export type WindowsLanPick = {
  name: string;
  ipv4: string;
  gateway: string | null;
};

export function isExcludedInterfaceName(name: string): boolean {
  return EXCLUDE_IFACE_RE.test(name || "");
}

export function isPreferredInterfaceName(name: string): boolean {
  return PREFER_IFACE_RE.test(name || "");
}

/**
 * Collect non-internal IPv4 addresses, excluding virtual/VPN-like adapter names.
 */
export function listLanCandidates(
  nets: NodeJS.Dict<NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
): LanCandidate[] {
  const out: LanCandidate[] = [];
  for (const [name, entries] of Object.entries(nets)) {
    if (!entries || isExcludedInterfaceName(name)) continue;
    for (const e of entries) {
      const family = String(e.family);
      const familyOk = family === "IPv4" || family === "4";
      if (familyOk && !e.internal && e.address) {
        out.push({ name, address: e.address });
      }
    }
  }
  return out;
}

/**
 * On Windows, pick an Up adapter with IPv4 + default gateway (prefer physical LAN).
 */
export function tryResolveWindowsLanPick(): WindowsLanPick | null {
  if (process.platform !== "win32") return null;
  try {
    const script =
      "$ErrorActionPreference='Stop';" +
      "$c=Get-NetIPConfiguration -ErrorAction SilentlyContinue |" +
      " Where-Object { $_.NetAdapter.Status -eq 'Up' -and $_.IPv4DefaultGateway -ne $null -and $_.IPv4Address -ne $null };" +
      "$pick=$c | Where-Object { $_.NetAdapter.InterfaceDescription -notmatch 'Hyper-V|Docker|WSL|vEthernet|Virtual|VPN|TAP|Tunnel|WireGuard|Tailscale|ZeroTier' } | Select-Object -First 1;" +
      "if (-not $pick) { $pick=$c | Select-Object -First 1 };" +
      "if ($pick) { @{ name=[string]$pick.InterfaceAlias; ipv4=[string]$pick.IPv4Address.IPAddress; gateway=[string]$pick.IPv4DefaultGateway.NextHop } | ConvertTo-Json -Compress }";
    const raw = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { encoding: "utf8", timeout: 2000, windowsHide: true },
    );
    const line = String(raw || "")
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s.startsWith("{"));
    if (!line) return null;
    const j = JSON.parse(line) as { name?: string; ipv4?: string; gateway?: string };
    const ipv4 = String(j.ipv4 || "").trim();
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(ipv4)) return null;
    const gateway = String(j.gateway || "").trim();
    return {
      name: String(j.name || "").trim() || "Windows",
      ipv4,
      gateway: /^\d+\.\d+\.\d+\.\d+$/.test(gateway) ? gateway : null,
    };
  } catch {
    return null;
  }
}

/** @deprecated Prefer tryResolveWindowsLanPick — kept for callers that only need IPv4. */
export function tryResolveWindowsGatewayIpv4(): string | null {
  return tryResolveWindowsLanPick()?.ipv4 ?? null;
}

function rankCandidates(candidates: LanCandidate[]): LanCandidate[] {
  return [...candidates].sort((a, b) => {
    const pa = isPreferredInterfaceName(a.name) ? 0 : 1;
    const pb = isPreferredInterfaceName(b.name) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.name.localeCompare(b.name);
  });
}

export function subnetPrefix(ipv4: string): string {
  const parts = ipv4.split(".");
  if (parts.length !== 4) {
    throw new Error(`Invalid IPv4: ${ipv4}`);
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

/**
 * Deterministic /24 diagnostics from a known host IPv4 (unit-testable; no hard-coded store subnet).
 */
export function buildLanDiagnostics(input: {
  ipv4: string;
  gateway?: string | null;
  adapterName?: string | null;
}): LanDiagnostics {
  const ipv4 = input.ipv4.trim();
  const prefix = subnetPrefix(ipv4);
  return {
    adapterName: input.adapterName?.trim() || null,
    ipv4,
    subnet: `${prefix}.0/24`,
    gateway: input.gateway?.trim() || null,
    scanFrom: `${prefix}.1`,
    scanTo: `${prefix}.254`,
  };
}

/**
 * Resolve active LAN context for printer discovery UI + scan.
 * Never hard-codes 192.168.0.0/24 or 192.168.1.0/24.
 */
export function resolveLanContext(
  nets: NodeJS.Dict<NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
  options?: {
    windowsPick?: WindowsLanPick | null;
    resolveWindows?: boolean;
  },
): LanDiagnostics {
  const candidates = listLanCandidates(nets);
  const resolveWin = options?.resolveWindows !== false;
  const win =
    options && "windowsPick" in options
      ? options.windowsPick ?? null
      : resolveWin
        ? tryResolveWindowsLanPick()
        : null;

  if (win?.ipv4 && candidates.some((c) => c.address === win.ipv4)) {
    const match = candidates.find((c) => c.address === win.ipv4);
    return buildLanDiagnostics({
      ipv4: win.ipv4,
      gateway: win.gateway,
      adapterName: win.name || match?.name || null,
    });
  }

  const ranked = rankCandidates(candidates);
  if (ranked.length > 0) {
    const top = ranked[0]!;
    return buildLanDiagnostics({
      ipv4: top.address,
      gateway: win?.gateway && subnetPrefix(win.gateway) === subnetPrefix(top.address) ? win.gateway : null,
      adapterName: top.name,
    });
  }

  if (win?.ipv4 && win.ipv4 !== "127.0.0.1") {
    return buildLanDiagnostics({
      ipv4: win.ipv4,
      gateway: win.gateway,
      adapterName: win.name,
    });
  }

  return buildLanDiagnostics({
    ipv4: "127.0.0.1",
    gateway: null,
    adapterName: null,
  });
}

/**
 * Pick primary LAN IPv4 for /24 printer discovery.
 */
export function resolveLanIpv4(
  nets: NodeJS.Dict<NetworkInterfaceInfo[] | undefined> = networkInterfaces(),
  options?: { gatewayIpv4?: string | null; resolveGateway?: boolean },
): string | null {
  const ctx = resolveLanContext(nets, {
    resolveWindows: options?.resolveGateway !== false,
    windowsPick:
      options && "gatewayIpv4" in options && options.gatewayIpv4
        ? { name: "", ipv4: options.gatewayIpv4, gateway: null }
        : undefined,
  });
  return ctx.ipv4;
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
 * Subnet is derived from the active LAN adapter — never hard-coded.
 */
export async function discoverPrinters9100(options?: {
  port?: number;
  timeoutMs?: number;
  concurrency?: number;
  ipv4?: string;
  diagnostics?: LanDiagnostics;
}): Promise<LocalDiscoverResponse> {
  const port = options?.port ?? 9100;
  const timeoutMs = options?.timeoutMs ?? 350;
  const concurrency = options?.concurrency ?? 32;
  const diagnostics =
    options?.diagnostics ??
    (options?.ipv4
      ? buildLanDiagnostics({ ipv4: options.ipv4 })
      : resolveLanContext());

  const prefix = subnetPrefix(diagnostics.ipv4);
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    hosts.push(`${prefix}.${i}`);
  }

  logger.info(
    `DISCOVERY_ADAPTER name=${diagnostics.adapterName || "(unknown)"} ipv4=${diagnostics.ipv4} prefix=${prefix} gateway=${diagnostics.gateway || "(none)"}`,
    "DISCOVER",
  );
  logger.info(`DISCOVERY_SUBNET subnet=${diagnostics.subnet}`, "DISCOVER");

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
  printers.sort((a, b) => {
    const aa = Number(a.ip.split(".").pop());
    const bb = Number(b.ip.split(".").pop());
    return aa - bb;
  });

  await sleep(0);

  logger.info(`DISCOVERY_RESULT count=${printers.length}`, "DISCOVER");

  return {
    subnet: diagnostics.subnet,
    scanned: hosts.length,
    printers,
    adapterName: diagnostics.adapterName,
    ipv4: diagnostics.ipv4,
    gateway: diagnostics.gateway,
    scanFrom: diagnostics.scanFrom,
    scanTo: diagnostics.scanTo,
  };
}
