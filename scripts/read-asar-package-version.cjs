#!/usr/bin/env node
/**
 * Read package.json version from an Electron app.asar (not regex over whole archive).
 * Usage: node scripts/read-asar-package-version.mjs <asarPath>
 * stdout: version string only
 */
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

function resolveElectronAsar(clientRoot) {
  try {
    const req = Module.createRequire(path.join(clientRoot, "package.json"));
    return req.resolve("@electron/asar");
  } catch {
    // continue
  }
  const pnpm = path.join(clientRoot, "node_modules", ".pnpm");
  if (fs.existsSync(pnpm)) {
    for (const name of fs.readdirSync(pnpm)) {
      if (!name.startsWith("@electron+asar@")) continue;
      const pkgJson = path.join(pnpm, name, "node_modules", "@electron", "asar", "package.json");
      if (fs.existsSync(pkgJson)) {
        return path.join(pnpm, name, "node_modules", "@electron", "asar");
      }
    }
  }
  const flat = path.join(clientRoot, "node_modules", "@electron", "asar");
  if (fs.existsSync(path.join(flat, "package.json"))) return flat;
  return null;
}

function main() {
  const asarPath = path.resolve(process.argv[2] || "");
  if (!asarPath || !fs.existsSync(asarPath)) {
    console.error(`READ_ASAR_FAIL: missing asar ${asarPath}`);
    process.exit(1);
  }
  const clientRoot = path.resolve(__dirname, "..", "mjh-printer-client");
  const asarMod = resolveElectronAsar(clientRoot);
  if (!asarMod) {
    console.error("READ_ASAR_FAIL: @electron/asar not found under mjh-printer-client/node_modules");
    process.exit(1);
  }
  const asar = require(asarMod);
  let buf;
  try {
    buf = asar.extractFile(asarPath, "package.json");
  } catch (e) {
    console.error(`READ_ASAR_FAIL: extract package.json: ${e.message || e}`);
    process.exit(1);
  }
  const pkg = JSON.parse(Buffer.from(buf).toString("utf8"));
  const ver = String(pkg.version || "");
  if (!/^\d+\.\d+\.\d+$/.test(ver)) {
    console.error(`READ_ASAR_FAIL: bad version '${ver}' in asar package.json`);
    process.exit(1);
  }
  process.stdout.write(ver);
}

main();
