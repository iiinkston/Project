"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, writeFile, mkdir, rm, readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  ELEVATION_REQUIRED,
  launchElevatedClientUpdateApply,
  resolveApplyRequestPath,
} = require("./client-update-elevation.cjs");
const { createClientUpdateService } = require("./client-update-service.cjs");

const lifecyclePs1 = join(__dirname, "..", "scripts", "client-update-lifecycle.ps1");

function runLifecycleProbe(scriptBody) {
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

test("scheduled task Apply success shape + apply-request versions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-life-task-"));
  try {
    const script = join(dir, "update-client.ps1");
    await writeFile(script, "# mock", "utf8");
    const updates = join(dir, "local", "MJH Printer Client", "updates");
    await mkdir(updates, { recursive: true });
    await writeFile(join(updates, "MJH Printer Setup.exe"), "setup-bytes", "utf8");
    await writeFile(
      join(updates, "ota-state.json"),
      JSON.stringify({
        ready: true,
        downloadedVersion: "1.0.13",
        remoteSha256: null,
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
    assert.equal(req.newVersion, "1.0.13");
    assert.equal(req.oldVersion, "1.0.8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installer exit 0 but install path wrong => Assert fails", () => {
  const dir = join(tmpdir(), `mjh-life-missing-${Date.now()}`);
  const fakeExe = join(dir, "missing", "MJH Printer Client.exe");
  const probe = runLifecycleProbe(`
$r = Assert-MjhClientInstalled -InstallDir '${dir.replace(/'/g, "''")}' -ClientExe '${fakeExe.replace(/'/g, "''")}' -TargetVersion '1.0.13'
@{ ok = $r.ok; error = $r.error } | ConvertTo-Json -Compress
`);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const j = JSON.parse(probe.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop());
  assert.equal(j.ok, false);
  assert.match(String(j.error), /missing|EXE/i);
});

test("installer exit 0 but version mismatch => Assert fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-life-ver-"));
  try {
    const exe = join(dir, "MJH Printer Client.exe");
    await writeFile(exe, "fake-exe", "utf8");
    // asar with wrong version 1.0.8 while target is 1.0.13
    await mkdir(join(dir, "resources"), { recursive: true });
    const asarBody = Buffer.from(
      '{"name":"mjh-printer-client","version":"1.0.8","private":true}',
      "utf8",
    );
    await writeFile(join(dir, "resources", "app.asar"), asarBody);
    const probe = runLifecycleProbe(`
$r = Assert-MjhClientInstalled -InstallDir '${dir.replace(/'/g, "''")}' -ClientExe '${exe.replace(/'/g, "''")}' -TargetVersion '1.0.13'
@{ ok = $r.ok; installedVersion = $r.installedVersion; error = $r.error } | ConvertTo-Json -Compress
`);
    assert.equal(probe.status, 0, probe.stderr || probe.stdout);
    const j = JSON.parse(probe.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop());
    assert.equal(j.ok, false);
    assert.equal(j.installedVersion, "1.0.8");
    assert.match(String(j.error), /1\.0\.8.*1\.0\.13|!= target/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("launch failure when exe missing => Start-MjhClientInteractive fails explicitly", () => {
  const missing = join(tmpdir(), `no-client-${Date.now()}.exe`);
  const probe = runLifecycleProbe(`
$r = Start-MjhClientInteractive -ClientExe '${missing.replace(/'/g, "''")}' -SettleSeconds 0
@{ ok = $r.ok; mode = $r.mode; error = $r.error } | ConvertTo-Json -Compress
`);
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  const j = JSON.parse(probe.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith("{")).pop());
  assert.equal(j.ok, false);
  assert.equal(j.mode, "missing-exe");
  assert.match(String(j.error), /missing/i);
});

test("launchElevated passes ExpectedSha256 into apply-request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-life-sha-"));
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
      expectedSha256: "deadbeef",
      elevated: true,
      programDataRoot: dir,
      startDirect: () => 1,
    });
    assert.equal(existsSync(resolveApplyRequestPath(dir)), true);
    const req = JSON.parse(await readFile(resolveApplyRequestPath(dir), "utf8"));
    assert.equal(req.expectedSha256, "deadbeef");
    assert.equal(req.newVersion, "1.0.13");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
