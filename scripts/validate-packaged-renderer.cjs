#!/usr/bin/env node
/**
 * Validate Vite→Electron packaged renderer assets.
 *
 * Checks:
 *  1) dist/index.html uses relative ./assets/ (never href|src="/assets/")
 *  2) referenced JS/CSS files exist under dist/assets/
 *  3) optional app.asar contains dist/index.html + those assets
 *  4) optional win-unpacked EXE smoke (--mjh-renderer-smoke)
 *
 * Usage:
 *   node scripts/validate-packaged-renderer.cjs
 *   node scripts/validate-packaged-renderer.cjs --asar dist/client-build/win-unpacked/resources/app.asar
 *   node scripts/validate-packaged-renderer.cjs --asar ... --exe ".../MJH Printer Client.exe" --smoke
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const Module = require("node:module");

function fail(msg) {
  console.error(`PACKAGED_RENDERER_FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`PACKAGED_RENDERER_OK: ${msg}`);
}

function parseArgs(argv) {
  const out = { asar: "", exe: "", smoke: false, dist: "" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--smoke") out.smoke = true;
    else if (a === "--asar") out.asar = argv[++i] || "";
    else if (a === "--exe") out.exe = argv[++i] || "";
    else if (a === "--dist") out.dist = argv[++i] || "";
  }
  return out;
}

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
      const mod = path.join(pnpm, name, "node_modules", "@electron", "asar");
      if (fs.existsSync(path.join(mod, "package.json"))) return mod;
    }
  }
  const flat = path.join(clientRoot, "node_modules", "@electron", "asar");
  if (fs.existsSync(path.join(flat, "package.json"))) return flat;
  return null;
}

function assertHtmlAssetPaths(html, label) {
  if (/(?:href|src)=["']\/assets\//i.test(html)) {
    fail(`${label} contains absolute /assets/ references (breaks Electron file://)`);
  }
  if (/crossorigin/i.test(html)) {
    fail(`${label} still contains crossorigin (breaks file:// asset load)`);
  }
  const refs = [];
  const re = /(?:href|src)=["'](\.\/assets\/[^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  if (refs.length === 0) {
    fail(`${label} has no ./assets/ script/link references`);
  }
  return refs;
}

function main() {
  const args = parseArgs(process.argv);
  const root = path.resolve(__dirname, "..");
  const clientRoot = path.join(root, "mjh-printer-client");
  const distDir = path.resolve(args.dist || path.join(clientRoot, "dist"));
  const htmlPath = path.join(distDir, "index.html");

  if (!fs.existsSync(htmlPath)) {
    fail(`missing ${htmlPath} (run pnpm build first)`);
  }
  const html = fs.readFileSync(htmlPath, "utf8");
  const refs = assertHtmlAssetPaths(html, "dist/index.html");
  ok(`dist/index.html relative assets: ${refs.join(", ")}`);

  for (const rel of refs) {
    const filePath = path.join(distDir, rel.replace(/^\.\//, ""));
    if (!fs.existsSync(filePath)) {
      fail(`referenced asset missing: ${filePath}`);
    }
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size < 1) {
      fail(`referenced asset empty: ${filePath}`);
    }
  }
  ok(`dist/assets files present (${refs.length})`);

  // Asar checks only after packaging (explicit --asar / --smoke). Skip stale win-unpacked
  // asar during the pre-electron-builder dist gate so an old build cannot fail a fresh vite output.
  const wantAsar = Boolean(args.asar) || args.smoke;
  let asarPath = args.asar
    ? path.resolve(args.asar)
    : path.join(root, "dist", "client-build", "win-unpacked", "resources", "app.asar");

  if (wantAsar) {
    if (!fs.existsSync(asarPath)) {
      fail(`asar not found at ${asarPath}`);
    }
    const asarMod = resolveElectronAsar(clientRoot);
    if (!asarMod) fail("@electron/asar not found");
    const asar = require(asarMod);
    let asarHtml;
    try {
      asarHtml = Buffer.from(asar.extractFile(asarPath, "dist/index.html")).toString("utf8");
    } catch (e) {
      fail(`app.asar missing dist/index.html: ${e.message || e}`);
    }
    const asarRefs = assertHtmlAssetPaths(asarHtml, "app.asar dist/index.html");
    ok(`app.asar index.html relative assets: ${asarRefs.join(", ")}`);
    // electron-builder asar on Windows may store keys as \dist\assets\... — match via listPackage.
    const packaged = new Set(
      asar.listPackage(asarPath).map((entry) =>
        String(entry)
          .replace(/\\/g, "/")
          .replace(/^\//, "")
      )
    );
    for (const rel of asarRefs) {
      const asarRel = path.posix.join("dist", rel.replace(/^\.\//, ""));
      if (!packaged.has(asarRel)) {
        fail(`app.asar missing ${asarRel}`);
      }
      const candidates = [asarRel, `/${asarRel}`, asarRel.replace(/\//g, "\\"), `\\${asarRel.replace(/\//g, "\\")}`];
      let buf = null;
      let lastErr = null;
      for (const key of candidates) {
        try {
          buf = asar.extractFile(asarPath, key);
          if (buf && buf.length > 0) break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!buf || buf.length < 1) {
        fail(`app.asar asset empty/unreadable: ${asarRel}: ${(lastErr && lastErr.message) || lastErr || "no data"}`);
      }
    }
    ok(`app.asar dist/assets verified`);
  } else if (fs.existsSync(asarPath)) {
    console.log(`PACKAGED_RENDERER_WARN: skip asar at ${asarPath} (pass --smoke or --asar to verify package)`);
  }

  if (args.smoke) {
    let exe = args.exe
      ? path.resolve(args.exe)
      : path.join(root, "dist", "client-build", "win-unpacked", "MJH Printer Client.exe");
    if (!fs.existsSync(exe)) {
      fail(`smoke EXE missing: ${exe}`);
    }
    ok(`smoke exe=${exe}`);
    const r = spawnSync(exe, ["--mjh-renderer-smoke"], {
      encoding: "utf8",
      timeout: 45000,
      windowsHide: true,
      env: {
        ...process.env,
        // Avoid colliding with a running interactive instance when possible.
        ELECTRON_NO_ATTACH_CONSOLE: "1",
      },
    });
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    if (r.status !== 0) {
      fail(`renderer smoke exit=${r.status} signal=${r.signal}\n${out.slice(-2000)}`);
    }
    ok("packaged EXE renderer smoke PASS");
  }

  ok("packaged renderer validation PASS");
}

main();
