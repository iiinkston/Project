"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  formatAppStartLog,
  formatRendererCrashLog,
  formatRendererRecoveryLog,
  formatSecondInstanceLog,
  planRendererRecovery,
} = require("./stability-lib.cjs");

test("formatAppStartLog includes version and hwAccel off", () => {
  const line = formatAppStartLog({
    version: "1.0.4",
    execPath: "C:\\Program Files\\MJH Printer\\MJH Printer Client.exe",
    hardwareAcceleration: false,
    singleInstance: true,
  });
  assert.match(line, /version=1\.0\.4/);
  assert.match(line, /hwAccel=off/);
  assert.match(line, /singleInstance=yes/);
});

test("formatRendererCrashLog includes recoveryCount", () => {
  const line = formatRendererCrashLog({
    reason: "crashed",
    exitCode: -1,
    recoveryCount: 2,
    version: "1.0.4",
  });
  assert.match(line, /recoveryCount=2/);
  assert.match(line, /version=1\.0\.4/);
  assert.match(line, /reason=crashed/);
});

test("formatRendererRecoveryLog and second-instance", () => {
  assert.match(
    formatRendererRecoveryLog({ recoveryCount: 1, version: "1.0.4" }),
    /recoveryCount=1/,
  );
  assert.match(formatSecondInstanceLog({ version: "1.0.4" }), /second-instance/);
});

test("planRendererRecovery increments and skips when quitting", () => {
  const a = planRendererRecovery({ recoveryCount: 0 }, { isQuitting: false, windowAlive: true });
  assert.equal(a.shouldReload, true);
  assert.equal(a.recoveryCount, 1);

  const b = planRendererRecovery(a, { isQuitting: true, windowAlive: true });
  assert.equal(b.shouldReload, false);
  assert.equal(b.recoveryCount, 2);

  const c = planRendererRecovery(a, { isQuitting: false, windowAlive: false });
  assert.equal(c.shouldReload, false);
});
