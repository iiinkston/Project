/**
 * Build production Windows EXE:
 * 1) esbuild bundle → dist/bundle.cjs
 * 2) @yao-pkg/pkg → dist/windows/MJH-Printer-Agent.exe
 * 3) EXE smoke (version / config:check / agent:start --dry-run)
 * 4) assemble flat release/ folder + zip
 */
import * as esbuild from "esbuild";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkgJson.version;
const buildStamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const releaseDir = join(root, "release");
const releaseZipShort = join(root, "release", `MJH-Printer-Agent-v${version}.zip`);
const releaseZipLong = join(root, "release", `MJH-Printer-Agent-v${version}-win-x64.zip`);
const distBundle = join(root, "dist", "bundle.cjs");
const exeOut = join(root, "dist", "windows", "MJH-Printer-Agent.exe");

mkdirSync(join(root, "dist", "windows"), { recursive: true });

console.log("[build] esbuild bundle...");
await esbuild.build({
  entryPoints: [join(root, "src", "index.ts")],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: distBundle,
  sourcemap: false,
  legalComments: "none",
  define: {
    __MJH_VERSION__: JSON.stringify(version),
    __MJH_BUILD__: JSON.stringify(buildStamp),
    "import.meta.url": JSON.stringify("file:///mjh-printer-agent/dist/bundle.cjs"),
  },
});

// Fail build if bundle still contains dynamic import() — pkg node22 cannot run it.
const bundleText = readFileSync(distBundle, "utf8");
if (/\bimport\s*\(/.test(bundleText)) {
  throw new Error("[build] FATAL: dist/bundle.cjs still contains import() — not pkg-safe");
}

console.log("[build] pkg executable...");
const pkgCli = require.resolve("@yao-pkg/pkg/lib-es5/bin.js");
const pkgTarget = process.env.MJH_PKG_TARGET || "node22-win-x64";
if (!pkgTarget.includes("node22")) {
  console.warn(`[build] WARN: expected node22 target, got ${pkgTarget}`);
}
execFileSync(
  process.execPath,
  [pkgCli, distBundle, "--targets", pkgTarget, "--output", exeOut],
  { stdio: "inherit", cwd: root },
);

function runExeSmoke(args, envExtra = {}) {
  const result = spawnSync(exeOut, args, {
    encoding: "utf8",
    env: { ...process.env, ...envExtra },
    windowsHide: true,
    timeout: 60_000,
  });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const combined = `${stdout}\n${stderr}`;
  if (combined.includes("A dynamic import callback was not specified")) {
    throw new Error(`[smoke] FATAL dynamic import on: ${args.join(" ")}\n${combined}`);
  }
  return { code: result.status ?? 1, stdout, stderr, combined };
}

console.log("[build] EXE smoke tests...");
{
  const ver = runExeSmoke(["version"]);
  if (ver.code !== 0 || !ver.stdout.includes("Version:")) {
    throw new Error(`[smoke] version failed:\n${ver.combined}`);
  }
  if (!ver.stdout.includes(version)) {
    throw new Error(`[smoke] version mismatch, expected ${version}:\n${ver.stdout}`);
  }
  console.log("[smoke] version PASS");

  const smokeRoot = join(tmpdir(), `mjh-exe-smoke-${Date.now()}`);
  mkdirSync(join(smokeRoot, "config"), { recursive: true });
  mkdirSync(join(smokeRoot, "data"), { recursive: true });
  mkdirSync(join(smokeRoot, "logs"), { recursive: true });
  copyFileSync(join(root, "config", "printer.json"), join(smokeRoot, "config", "printer.json"));
  const smokeEnv = {
    MJH_PROGRAMDATA_DIR: smokeRoot,
    MJH_CONFIG_PATH: join(smokeRoot, "config", "printer.json"),
  };

  const check = runExeSmoke(["config:check"], smokeEnv);
  if (check.code !== 0 && check.code !== 2) {
    // 2 = missing token etc is config content; crash is worse
    throw new Error(`[smoke] config:check crashed:\n${check.combined}`);
  }
  if (check.combined.includes("Fatal error")) {
    throw new Error(`[smoke] config:check fatal:\n${check.combined}`);
  }
  console.log("[smoke] config:check PASS");

  const dry = runExeSmoke(["agent:start", "--dry-run", "--agent-process"], smokeEnv);
  if (dry.code !== 0 || !dry.combined.includes("DRY-RUN PASS")) {
    throw new Error(`[smoke] agent:start --dry-run failed:\n${dry.combined}`);
  }
  const statusPath = join(smokeRoot, "data", "status.json");
  const dryOkPath = join(smokeRoot, "data", "dry-run-ok.json");
  if (!existsSync(statusPath)) {
    throw new Error(`[smoke] status.json not created at ${statusPath}`);
  }
  if (!existsSync(dryOkPath)) {
    throw new Error(`[smoke] dry-run-ok.json not created at ${dryOkPath}`);
  }
  console.log("[smoke] agent:start --dry-run PASS (status + lock verified during run)");

  // Real start ~5s then stop — proves worker path does not crash.
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      `
      const { spawn } = require('child_process');
      const fs = require('fs');
      const exe = ${JSON.stringify(exeOut)};
      const env = ${JSON.stringify({ ...process.env, ...smokeEnv })};
      const statusPath = ${JSON.stringify(statusPath)};
      const child = spawn(exe, ['agent:start', '--agent-process'], { env, stdio: ['ignore','pipe','pipe'] });
      let out = '';
      child.stdout.on('data', d => out += d);
      child.stderr.on('data', d => out += d);
      setTimeout(() => {
        try { process.kill(child.pid); } catch {}
        setTimeout(() => {
          if (out.includes('A dynamic import callback was not specified')) {
            console.error(out);
            process.exit(2);
          }
          if (out.includes('[MJH] Fatal error')) {
            console.error(out);
            process.exit(3);
          }
          if (!fs.existsSync(statusPath)) {
            console.error('status.json missing');
            process.exit(4);
          }
          const st = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
          if (!st.pid || !st.version || !st.startedAt) {
            console.error('status.json incomplete', st);
            process.exit(5);
          }
          process.exit(0);
        }, 800);
      }, 5000);
      `,
    ],
    { encoding: "utf8", timeout: 20_000, windowsHide: true },
  );
  if ((child.status ?? 1) !== 0) {
    throw new Error(`[smoke] agent:start 5s failed:\n${child.stdout}\n${child.stderr}`);
  }
  console.log("[smoke] agent:start 5s PASS (status.json pid/version/startedAt)");

  rmSync(smokeRoot, { recursive: true, force: true });
}

console.log("[build] assemble flat release/ ...");
if (existsSync(releaseDir)) {
  for (const name of readdirSync(releaseDir, { withFileTypes: true })) {
    const full = join(releaseDir, name.name);
    if (name.isDirectory() || name.name.endsWith(".zip")) {
      rmSync(full, { recursive: true, force: true });
    }
  }
}
for (const name of [
  "MJH-Printer-Agent.exe",
  "README.md",
  "install.ps1",
  "uninstall.ps1",
  "update-agent.ps1",
  "start.ps1",
  "stop.ps1",
  "restart.ps1",
  "status.ps1",
  "logs.ps1",
]) {
  const p = join(releaseDir, name);
  if (existsSync(p)) rmSync(p, { force: true });
}
rmSync(join(releaseDir, "config"), { recursive: true, force: true });
rmSync(join(releaseDir, "scripts"), { recursive: true, force: true });

mkdirSync(releaseDir, { recursive: true });
mkdirSync(join(releaseDir, "config"), { recursive: true });

copyFileSync(exeOut, join(releaseDir, "MJH-Printer-Agent.exe"));
copyFileSync(join(root, "config", "printer.json"), join(releaseDir, "config", "printer.json"));

const scriptFiles = [
  "install.ps1",
  "uninstall.ps1",
  "update-agent.ps1",
  "start.ps1",
  "stop.ps1",
  "restart.ps1",
  "status.ps1",
  "logs.ps1",
];
for (const name of scriptFiles) {
  const src = join(root, "scripts", name);
  if (!existsSync(src)) {
    throw new Error(`Missing script required in release: scripts/${name}`);
  }
  copyFileSync(src, join(releaseDir, name));
}

writeFileSync(
  join(releaseDir, "README.md"),
  `# 满江红打印机代理 MJH Printer Agent v${version}

Build: \`${buildStamp}\`

## 安装（管理员 PowerShell）

\`\`\`powershell
cd <本目录>
.\\install.ps1
\`\`\`

## 升级

\`\`\`powershell
.\\update-agent.ps1 -Source ".\\MJH-Printer-Agent.exe"
\`\`\`

## 诊断

\`\`\`powershell
.\\MJH-Printer-Agent.exe version
.\\MJH-Printer-Agent.exe doctor
.\\MJH-Printer-Agent.exe agent:diagnose
.\\MJH-Printer-Agent.exe agent:start --dry-run
\`\`\`
`,
  "utf8",
);

writeFileSync(
  join(releaseDir, "BUILD.txt"),
  `version=${version}\nbuild=${buildStamp}\npkgTarget=${pkgTarget}\n`,
  "utf8",
);

rmSync(releaseZipShort, { force: true });
rmSync(releaseZipLong, { force: true });
const staging = join(root, "release", `.zip-staging-v${version}`);
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
for (const name of ["MJH-Printer-Agent.exe", "README.md", "BUILD.txt", ...scriptFiles]) {
  copyFileSync(join(releaseDir, name), join(staging, name));
}
mkdirSync(join(staging, "config"), { recursive: true });
copyFileSync(join(releaseDir, "config", "printer.json"), join(staging, "config", "printer.json"));

try {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${staging}\\*' -DestinationPath '${releaseZipShort}' -Force; Copy-Item -Force '${releaseZipShort}' '${releaseZipLong}'`,
    ],
    { stdio: "inherit" },
  );
} catch {
  console.warn("[build] zip failed — flat release/ folder is still available");
} finally {
  rmSync(staging, { recursive: true, force: true });
}

const size = statSync(exeOut).size;
console.log(`[build] EXE: ${exeOut}`);
console.log(`[build] size: ${(size / (1024 * 1024)).toFixed(2)} MB`);
console.log(`[build] version: ${version}`);
console.log(`[build] build: ${buildStamp}`);
console.log(`[build] release: ${releaseDir}`);
if (existsSync(releaseZipShort)) {
  console.log(`[build] zip: ${releaseZipShort}`);
}
