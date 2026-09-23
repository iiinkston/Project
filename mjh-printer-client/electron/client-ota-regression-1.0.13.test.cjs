"use strict";

/**
 * Regression gates for Client OTA 1.0.8 -> 1.0.13 production fix.
 * Simulates check/download/verify/restart-request without running NSIS.
 */
const assert = require("node:assert/strict");
const { mkdtemp, writeFile, mkdir, rm, readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { test } = require("node:test");
const {
  compareVersions,
  normalizeSha256,
  parseClientManifest,
} = require("./client-update-lib.cjs");
const {
  ELEVATION_REQUIRED,
  launchElevatedClientUpdateApply,
  resolveApplyRequestPath,
} = require("./client-update-elevation.cjs");
const { createClientUpdateService } = require("./client-update-service.cjs");

const lifecyclePs1 = join(__dirname, "..", "scripts", "client-update-lifecycle.ps1");

function runPs(scriptBody) {
  const ps = `
$ErrorActionPreference = 'Stop'
. '${lifecyclePs1.replace(/'/g, "''")}'
${scriptBody}
`;
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { encoding: "utf8", windowsHide: true },
  );
  return {
    status: r.status,
    stdout: (r.stdout || "").trim(),
    stderr: (r.stderr || "").trim(),
  };
}

function lastJson(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .pop();
  assert.ok(line, `expected JSON in stdout: ${stdout}`);
  return JSON.parse(line);
}

test("regression 1.0.8->1.0.13: check says update available", () => {
  assert.equal(compareVersions("1.0.13", "1.0.8") > 0, true);
  assert.equal(compareVersions("1.0.8", "1.0.13") < 0, true);
  assert.equal(compareVersions("1.0.13", "1.0.13") === 0, true);
});

test("regression 1.0.8->1.0.13: manifest parse + SHA normalize", () => {
  const remote = parseClientManifest({
    client: {
      version: "1.0.13",
      url: "https://example.com/MJH-Printer-Setup.exe",
      sha256: "SHA256: aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
    },
  });
  assert.equal(remote.clientVersion, "1.0.13");
  assert.equal(
    normalizeSha256(remote.clientSha256),
    "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
  );
});

test("regression 1.0.8->1.0.13: download SHA PASS then Apply schedules task", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-reg-ota-"));
  try {
    const payload = Buffer.from("fake-setup-1.0.13");
    const sha = createHash("sha256").update(payload).digest("hex");
    const script = join(dir, "update-client.ps1");
    await writeFile(script, "# mock", "utf8");
    const updates = join(dir, "local", "MJH Printer Client", "updates");
    await mkdir(updates, { recursive: true });
    await writeFile(join(updates, "MJH Printer Setup.exe"), payload);
    await writeFile(
      join(updates, "ota-state.json"),
      JSON.stringify({
        ready: true,
        downloadedVersion: "1.0.13",
        remoteSha256: sha,
        remoteVersion: "1.0.13",
      }),
      "utf8",
    );

    let taskCalls = 0;
    const svc = createClientUpdateService({
      app: { getVersion: () => "1.0.8", getPath: () => dir },
      log: () => {},
      resolveUpdaterScript: () => script,
      isElevated: () => false,
      tryScheduledTask: () => {
        taskCalls += 1;
        return true;
      },
      startDirect: () => {
        throw new Error("must not direct");
      },
      startUac: () => {
        throw new Error("must not uac");
      },
      programDataRoot: dir,
    });
    process.env.LOCALAPPDATA = join(dir, "local");

    const result = await svc.apply();
    assert.equal(result.ok, false);
    assert.equal(result.code, ELEVATION_REQUIRED);
    assert.equal(result.elevationStarted, true);
    assert.equal(result.mode, "scheduled-task");
    assert.equal(taskCalls, 1);

    const req = JSON.parse(await readFile(resolveApplyRequestPath(dir), "utf8"));
    assert.equal(req.oldVersion, "1.0.8");
    assert.equal(req.newVersion, "1.0.13");
    assert.equal(req.expectedSha256, sha);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regression: installer exit0 but still 1.0.8 => verify FAIL (no UPDATE DONE)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-reg-badver-"));
  try {
    const exe = join(dir, "MJH Printer Client.exe");
    await writeFile(exe, "x", "utf8");
    await mkdir(join(dir, "resources"), { recursive: true });
    await writeFile(
      join(dir, "resources", "app.asar"),
      Buffer.from('{"name":"mjh-printer-client","version":"1.0.8"}', "utf8"),
    );
    const probe = runPs(`
$r = Assert-MjhClientInstalled -InstallDir '${dir.replace(/'/g, "''")}' -ClientExe '${exe.replace(/'/g, "''")}' -TargetVersion '1.0.13'
@{ ok=$r.ok; installedVersion=$r.installedVersion; error=$r.error } | ConvertTo-Json -Compress
`);
    assert.equal(probe.status, 0, probe.stderr);
    const j = lastJson(probe.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.installedVersion, "1.0.8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regression: installed 1.0.13 asar+path => verify PASS", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-reg-goodver-"));
  try {
    const exe = join(dir, "MJH Printer Client.exe");
    await writeFile(exe, "x", "utf8");
    await mkdir(join(dir, "resources"), { recursive: true });
    await writeFile(
      join(dir, "resources", "app.asar"),
      Buffer.from('{"name":"mjh-printer-client","version":"1.0.13"}', "utf8"),
    );
    const probe = runPs(`
$r = Assert-MjhClientInstalled -InstallDir '${dir.replace(/'/g, "''")}' -ClientExe '${exe.replace(/'/g, "''")}' -TargetVersion '1.0.13'
@{ ok=$r.ok; installedVersion=$r.installedVersion } | ConvertTo-Json -Compress
`);
    assert.equal(probe.status, 0, probe.stderr);
    const j = lastJson(probe.stdout);
    assert.equal(j.ok, true);
    assert.equal(j.installedVersion, "1.0.13");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regression: restart-request written; missing exe launch FAIL", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-reg-restart-"));
  try {
    const missing = join(dir, "missing-client.exe");
    const probe = runPs(`
$pd = '${dir.replace(/'/g, "''")}'
$r = Invoke-MjhUserSessionRestart -ClientExe '${missing.replace(/'/g, "''")}' -OldVersion '1.0.8' -TargetVersion '1.0.13' -InstalledVersion '1.0.13' -ProgramDataDir $pd -SettleSeconds 0
$req = Join-Path $pd 'updates\\restart-request.json'
@{ ok=$r.ok; launchMethod=$r.launchMethod; launchResult=$r.launchResult; reqExists=(Test-Path -LiteralPath $req) } | ConvertTo-Json -Compress
`);
    assert.equal(probe.status, 0, probe.stderr);
    const j = lastJson(probe.stdout);
    assert.equal(j.ok, false);
    assert.equal(j.launchResult, "FAIL");
    assert.equal(j.reqExists, true);
    assert.ok(existsSync(join(dir, "updates", "restart-request.json")));
    const req = JSON.parse(await readFile(join(dir, "updates", "restart-request.json"), "utf8"));
    assert.equal(req.targetVersion, "1.0.13");
    assert.equal(req.forbidSessionZero, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("regression: next check after 1.0.13 reports no update", () => {
  assert.equal(compareVersions("1.0.13", "1.0.13") <= 0, true);
  assert.equal(compareVersions("1.0.13", "1.0.13") > 0, false);
});

test("regression: apply-request carries 1.0.13 + sha for helper", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-reg-req-"));
  try {
    const script = join(dir, "update-client.ps1");
    const setup = join(dir, "setup.exe");
    await writeFile(script, "#", "utf8");
    await writeFile(setup, "x", "utf8");
    launchElevatedClientUpdateApply({
      scriptPath: script,
      setupPath: setup,
      oldVersion: "1.0.8",
      newVersion: "1.0.13",
      expectedSha256: "abc",
      elevated: true,
      programDataRoot: dir,
      startDirect: () => 1,
    });
    const req = JSON.parse(await readFile(resolveApplyRequestPath(dir), "utf8"));
    assert.equal(req.oldVersion, "1.0.8");
    assert.equal(req.newVersion, "1.0.13");
    assert.equal(req.expectedSha256, "abc");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
