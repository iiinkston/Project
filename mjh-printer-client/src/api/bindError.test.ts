import assert from "node:assert/strict";
import { test } from "node:test";
import { bindRequestBody, extractApiErrorMessage, userBindMessage } from "./bindError.ts";

test("bind body sends code and not pairCode", () => {
  const body = bindRequestBody(" MJH-001 ");
  assert.deepEqual(body, { code: "MJH-001" });
  assert.equal("pairCode" in body, false);
});

test("nested error.message is not [object Object]", () => {
  const message = extractApiErrorMessage({
    error: { message: "PAIRING_CODE_INVALID" },
  });
  assert.equal(message, "PAIRING_CODE_INVALID");
  assert.equal(userBindMessage(message), "注册码无效，请检查后重试");
  assert.equal(userBindMessage("Invalid pairing code"), "注册码无效，请检查后重试");
  assert.equal(String({ error: { message: "PAIRING_CODE_INVALID" } }).includes("[object Object]"), true);
  assert.equal(message.includes("[object Object]"), false);
});

test("top-level message is used when error.message is missing", () => {
  assert.equal(extractApiErrorMessage({ message: "store offline" }), "store offline");
});
