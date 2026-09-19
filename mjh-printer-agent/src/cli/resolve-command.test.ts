import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveCommand, resolveDoctorFlags, resolveAgentStartDryRun } from "./resolve-command.js";

test("no args defaults to agent:start", () => {
  assert.equal(resolveCommand(["node", "index.js"]), "agent:start");
});

test("printer:test never runs implicitly", () => {
  assert.notEqual(resolveCommand(["node", "index.js"]), "printer:test");
  assert.equal(resolveCommand(["node", "index.js", "printer:test"]), "printer:test");
});

test("doctor --printer flag is detected", () => {
  assert.equal(resolveDoctorFlags(["node", "index.js", "doctor"]).printerOnly, false);
  assert.equal(resolveDoctorFlags(["node", "index.js", "doctor", "--printer"]).printerOnly, true);
});

test("agent:start --dry-run is detected", () => {
  assert.equal(resolveAgentStartDryRun(["exe", "x", "agent:start", "--dry-run"]), true);
  assert.equal(resolveAgentStartDryRun(["exe", "x", "agent:start"]), false);
  assert.equal(resolveAgentStartDryRun(["exe", "x", "doctor", "--dry-run"]), false);
});
