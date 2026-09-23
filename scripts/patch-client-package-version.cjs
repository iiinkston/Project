#!/usr/bin/env node
/**
 * Patch mjh-printer-client/package.json "version" in-place (CI workspace only).
 * Does NOT use electron-builder extraMetadata — updates the real file that is packed into app.asar.
 *
 * Usage:
 *   node scripts/patch-client-package-version.mjs --version 1.0.13
 *   node scripts/patch-client-package-version.mjs --version 1.0.13 --package mjh-printer-client/package.json
 */
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const out = { version: "", packageJson: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--version" || a === "-v") out.version = String(argv[++i] || "");
    else if (a === "--package" || a === "-p") out.packageJson = String(argv[++i] || "");
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  const version = (args.version || process.env.MJH_RELEASE_CLIENT_VERSION || "").trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    console.error(`PATCH_CLIENT_VERSION_FAIL: invalid version '${version}'`);
    process.exit(1);
  }

  const root = path.resolve(__dirname, "..");
  const pkgPath = path.resolve(
    args.packageJson || path.join(root, "mjh-printer-client", "package.json"),
  );
  if (!fs.existsSync(pkgPath)) {
    console.error(`PATCH_CLIENT_VERSION_FAIL: missing ${pkgPath}`);
    process.exit(1);
  }

  const beforeRaw = fs.readFileSync(pkgPath, "utf8");
  const beforePkg = JSON.parse(beforeRaw);
  const before = String(beforePkg.version || "");
  console.error(`BEFORE_PATCH_VERSION=${before}`);

  // Surgical replace of root "version" field so we preserve formatting / Unicode.
  // Root package.json always has "version" near the top; replace first occurrence only.
  if (!/"version"\s*:\s*"[^"]*"/.test(beforeRaw)) {
    console.error("PATCH_CLIENT_VERSION_FAIL: no version field in package.json");
    process.exit(1);
  }
  const afterRaw = beforeRaw.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`);
  fs.writeFileSync(pkgPath, afterRaw, "utf8");

  const afterPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const after = String(afterPkg.version || "");
  console.error(`AFTER_PATCH_VERSION=${after}`);

  if (after !== version) {
    console.error(`PATCH_CLIENT_VERSION_FAIL: after patch version='${after}' != '${version}'`);
    process.exit(2);
  }

  // Echo the version line for CI logs (user requirement: must show "version": "x.y.z")
  const verLine = afterRaw.split(/\r?\n/).find((l) => /"version"\s*:/.test(l));
  if (verLine) console.error(`PACKAGE_JSON_VERSION_LINE=${verLine.trim()}`);

  process.stdout.write(
    JSON.stringify({
      packageJson: pkgPath,
      previousVersion: before,
      clientVersion: after,
    }),
  );
}

main();
