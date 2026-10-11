/**
 * Stage a minimal Agent payload into the Client NSIS extraResources tree.
 * Do NOT copy the full Agent release directory (docs/helpers/zips).
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "..");
const src = join(project, "mjh-printer-agent", "release");
const dest = join(root, "installer", "agent-release");

/** Files required inside unified Setup for install / OTA apply / uninstall. */
const ALLOW_ROOT = [
  "MJH-Printer-Agent.exe",
  "BUILD.txt",
  "install.ps1",
  "uninstall.ps1",
  "update-agent.ps1",
  "apply-update-helper.ps1",
];

/** Config templates only — never ship bound printer.json with secrets/dev IPs. */
const ALLOW_CONFIG = ["printer.unbound.json", "update.json"];

/** Explicitly excluded from embedded payload (may still exist in Agent OTA zip). */
const FORBIDDEN = [
  "README.md",
  "start.ps1",
  "stop.ps1",
  "restart.ps1",
  "status.ps1",
  "logs.ps1",
  "printer.json",
];

function fail(msg) {
  console.error(`[stage-agent] FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(src)) {
  fail(`Agent release missing: ${src} (run mjh-printer-agent pnpm build:exe first)`);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(join(dest, "config"), { recursive: true });

for (const name of ALLOW_ROOT) {
  const from = join(src, name);
  if (!existsSync(from)) fail(`required file missing in Agent release: ${name}`);
  copyFileSync(from, join(dest, name));
}

for (const name of ALLOW_CONFIG) {
  const from = join(src, "config", name);
  if (!existsSync(from)) fail(`required config missing in Agent release: config/${name}`);
  copyFileSync(from, join(dest, "config", name));
}

// Guard: no nested zips / forbidden leftovers
for (const name of readdirSync(dest)) {
  const p = join(dest, name);
  if (statSync(p).isFile() && name.endsWith(".zip")) {
    fail(`unexpected zip in embedded payload: ${name}`);
  }
  if (FORBIDDEN.includes(name)) {
    fail(`forbidden file staged: ${name}`);
  }
}
if (existsSync(join(dest, "config", "printer.json"))) {
  fail("config/printer.json must not be embedded (use printer.unbound.json only)");
}

const unbound = join(dest, "config", "printer.unbound.json");
const unboundRaw = readFileSync(unbound, "utf8");
if (unboundRaw.includes("192.168.0.110") || /"ip"\s*:\s*"192\.168\./.test(unboundRaw)) {
  fail("printer.unbound.json must not contain a hard-coded LAN printer IP");
}

console.log(`[stage-agent] allowlist staged → ${dest}`);
console.log(`[stage-agent] root: ${ALLOW_ROOT.join(", ")}`);
console.log(`[stage-agent] config: ${ALLOW_CONFIG.join(", ")}`);
