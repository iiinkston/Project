"use strict";

const assert = require("node:assert/strict");
const { mkdtemp, writeFile, rm, readFile, mkdir } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const {
  ELEVATION_REQUIRED,
  CLIENT_UPDATE_TASK_NAME,
  launchElevatedClientUpdateApply,
  resolveApplyRequestPath,
} = require("./client-update-elevation.cjs");
const { createClientUpdateService } = require("./client-update-service.cjs");

test("Case 1: non-elevated Apply → ELEVATION_REQUIRED via scheduled task", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-elev-task-"));
  try {
    const script = join(dir, "update-client.ps1");
    const setup = join(dir, "MJH Printer Setup.exe");
    await writeFile(script, "# mock", "utf8");
    await writeFile(setup, "setup", "utf8");
    const updates = join(dir, "local", "MJH Printer Client", "updates");
    await mkdir(updates, { recursive: true });
    await writeFile(join(updates, "MJH Printer Setup.exe"), "setup", "utf8");
    await writeFile(
      join(updates, "ota-state.json"),
      JSON.stringify({
        ready: true,
        downloadedVersion: "1.0.8",
        remoteSha256: null,
      }),
      "utf8",
    );

    let taskCalls = 0;
    const svc = createClientUpdateService({
      app: { getVersion: () => "1.0.7", getPath: () => dir },
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
        throw new Error("must not uac when task works");
      },
      programDataRoot: dir,
    });

    // Patch paths via env LOCALAPPDATA
    process.env.LOCALAPPDATA = join(dir, "local");
    const result = await svc.apply();
    assert.equal(result.ok, false);
    assert.equal(result.code, ELEVATION_REQUIRED);
    assert.equal(result.elevationStarted, true);
    assert.equal(result.quitting, true);
    assert.equal(result.mode, "scheduled-task");
    assert.equal(taskCalls, 1);
    assert.match(result.error || "", /ELEVATION_REQUIRED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 2: elevated Apply → ok direct installer started", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-elev-admin-"));
  try {
    const script = join(dir, "update-client.ps1");
    const setup = join(dir, "MJH Printer Setup.exe");
    await writeFile(script, "# mock", "utf8");
    await writeFile(setup, "setup", "utf8");
    const updates = join(dir, "local", "MJH Printer Client", "updates");
    await mkdir(updates, { recursive: true });
    await writeFile(join(updates, "MJH Printer Setup.exe"), "setup", "utf8");
    await writeFile(
      join(updates, "ota-state.json"),
      JSON.stringify({
        ready: true,
        downloadedVersion: "1.0.8",
        remoteSha256: null,
      }),
      "utf8",
    );

    let directCalls = 0;
    const svc = createClientUpdateService({
      app: { getVersion: () => "1.0.7", getPath: () => dir },
      log: () => {},
      resolveUpdaterScript: () => script,
      isElevated: () => true,
      tryScheduledTask: () => {
        throw new Error("should not task when elevated");
      },
      startDirect: () => {
        directCalls += 1;
        return 4242;
      },
      startUac: () => {
        throw new Error("should not uac");
      },
      programDataRoot: dir,
    });

    process.env.LOCALAPPDATA = join(dir, "local");
    const result = await svc.apply();
    assert.equal(result.ok, true);
    assert.equal(result.mode, "direct");
    assert.equal(result.quitting, true);
    assert.equal(directCalls, 1);
    assert.match(result.message || "", /Update started/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 2b: non-elevated falls back to UAC when task missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-elev-uac-"));
  try {
    const script = join(dir, "update-client.ps1");
    const setup = join(dir, "MJH Printer Setup.exe");
    await writeFile(script, "# mock", "utf8");
    await writeFile(setup, "setup", "utf8");

    let uac = 0;
    const result = launchElevatedClientUpdateApply({
      scriptPath: script,
      setupPath: setup,
      oldVersion: "1.0.7",
      newVersion: "1.0.8",
      elevated: false,
      programDataRoot: dir,
      tryScheduledTask: () => false,
      startDirect: () => {
        throw new Error("no direct");
      },
      startUac: () => {
        uac += 1;
        return 99;
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "uac-runas");
    assert.equal(result.elevationStarted || result.elevationRequired, true);
    assert.equal(uac, 1);
    assert.equal(existsSync(resolveApplyRequestPath(dir)), true);
    const req = JSON.parse(await readFile(resolveApplyRequestPath(dir), "utf8"));
    assert.equal(req.setupPath, setup);
    assert.equal(req.oldVersion, "1.0.7");
    assert.equal(req.newVersion, "1.0.8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 3: launch writes apply-request for helper", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-client-req-"));
  try {
    const script = join(dir, "update-client.ps1");
    const setup = join(dir, "setup.exe");
    await writeFile(script, "#", "utf8");
    await writeFile(setup, "x", "utf8");
    launchElevatedClientUpdateApply({
      scriptPath: script,
      setupPath: setup,
      elevated: true,
      programDataRoot: dir,
      startDirect: () => 1,
    });
    const req = JSON.parse(await readFile(resolveApplyRequestPath(dir), "utf8"));
    assert.equal(req.script, script);
    assert.ok(req.requestedAt);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exports ELEVATION_REQUIRED constant and task name", () => {
  assert.equal(ELEVATION_REQUIRED, "ELEVATION_REQUIRED");
  assert.equal(CLIENT_UPDATE_TASK_NAME, "MJH Printer Client Update");
});
