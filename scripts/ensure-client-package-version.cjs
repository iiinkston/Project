#!/usr/bin/env node
/**
 * Ensure mjh-printer-client/package.json version matches MJH_RELEASE_CLIENT_VERSION.
 * Used immediately before pnpm dist:setup in CI so app.asar embeds the tag version.
 * No-op when MJH_RELEASE_CLIENT_VERSION is unset (local builds).
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const wanted = String(process.env.MJH_RELEASE_CLIENT_VERSION || "").trim();
if (!wanted) {
  process.exit(0);
}
if (!/^\d+\.\d+\.\d+$/.test(wanted)) {
  console.error(`ENSURE_CLIENT_VERSION_FAIL: invalid MJH_RELEASE_CLIENT_VERSION='${wanted}'`);
  process.exit(1);
}

const root = path.resolve(__dirname, "..");
const pkgPath = path.join(root, "mjh-printer-client", "package.json");
const patcher = path.join(__dirname, "patch-client-package-version.cjs");

const before = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
console.error(`BEFORE_PATCH_VERSION=${before}`);

if (String(before) !== wanted) {
  const r = spawnSync(process.execPath, [patcher, "--version", wanted, "--package", pkgPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

const after = JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
console.error(`AFTER_PATCH_VERSION=${after}`);
if (after !== wanted) {
  console.error(`ENSURE_CLIENT_VERSION_FAIL: package.json version='${after}' != '${wanted}'`);
  process.exit(2);
}

const raw = fs.readFileSync(pkgPath, "utf8");
const verLine = raw.split(/\r?\n/).find((l) => /"version"\s*:/.test(l));
if (verLine) console.error(`PACKAGE_JSON_VERSION_LINE=${verLine.trim()}`);
console.error(`ENSURE_CLIENT_VERSION_OK ${after}`);
