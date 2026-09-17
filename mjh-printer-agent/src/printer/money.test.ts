import assert from "node:assert/strict";
import { test } from "node:test";
import { minorToMoney, minorToMoneySpaced, minorToPlain } from "./money.js";

test("minorToMoney formats MYR without floating point", () => {
  assert.equal(minorToMoney(1290, "MYR"), "RM12.90");
  assert.equal(minorToMoney(300, "MYR"), "RM3.00");
  assert.equal(minorToMoney(5730, "MYR"), "RM57.30");
  assert.equal(minorToMoney(0, "MYR"), "RM0.00");
  assert.equal(minorToMoney(-200, "MYR"), "-RM2.00");
});

test("minorToPlain and spaced money helpers", () => {
  assert.equal(minorToPlain(3460), "34.60");
  assert.equal(minorToMoneySpaced(3460, "MYR"), "RM 34.60");
});
