import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ELEVATION_REQUIRED,
  launchElevatedUpdateApply,
  writeApplyRequest,
  resolveApplyRequestPath,
} from "./update-elevation.js";
import { handleUpdateApply } from "./update.js";

test("Case 1: elevated Apply launches direct and returns ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-elev-admin-"));
  try {
    const script = join(dir, "update-agent.ps1");
    const source = join(dir, "MJH-Printer-Agent.exe");
    await writeFile(script, "# mock", "utf8");
    await writeFile(source, "exe", "utf8");
    let directCalls = 0;
    const result = launchElevatedUpdateApply({
      scriptPath: script,
      sourcePath: source,
      elevated: true,
      programDataRoot: dir,
      tryScheduledTask: () => {
        throw new Error("should not call task when elevated");
      },
      startDirect: () => {
        directCalls += 1;
      },
      startUac: () => {
        throw new Error("should not UAC when elevated");
      },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.mode, "direct");
    }
    assert.equal(directCalls, 1);
    const reqPath = resolveApplyRequestPath(dir);
    assert.equal(existsSync(reqPath), true);
    const req = JSON.parse(await readFile(reqPath, "utf8")) as { source: string };
    assert.equal(req.source, source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 2: non-elevated Apply prefers scheduled task and signals elevation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-elev-user-"));
  try {
    const script = join(dir, "update-agent.ps1");
    const source = join(dir, "MJH-Printer-Agent.exe");
    await writeFile(script, "# mock", "utf8");
    await writeFile(source, "exe", "utf8");
    let taskCalls = 0;
    const result = launchElevatedUpdateApply({
      scriptPath: script,
      sourcePath: source,
      elevated: false,
      programDataRoot: dir,
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
    });
    assert.equal(result.ok, true);
    if (result.ok && "elevationRequired" in result) {
      assert.equal(result.mode, "scheduled-task");
      assert.equal(result.elevationRequired, true);
    }
    assert.equal(taskCalls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 2b: non-elevated falls back to UAC RunAs when task missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-elev-uac-"));
  try {
    const script = join(dir, "update-agent.ps1");
    const source = join(dir, "MJH-Printer-Agent.exe");
    await writeFile(script, "# mock", "utf8");
    await writeFile(source, "exe", "utf8");
    let uac = 0;
    const result = launchElevatedUpdateApply({
      scriptPath: script,
      sourcePath: source,
      elevated: false,
      programDataRoot: dir,
      tryScheduledTask: () => false,
      startDirect: () => {
        throw new Error("no");
      },
      startUac: () => {
        uac += 1;
      },
    });
    assert.equal(result.ok, true);
    if (result.ok && "mode" in result) {
      assert.equal(result.mode, "uac-runas");
    }
    assert.equal(uac, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Case 3: Apply failure returns success=false", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-elev-fail-"));
  try {
    const missingScript = join(dir, "missing-update-agent.ps1");
    const source = join(dir, "MJH-Printer-Agent.exe");
    await writeFile(source, "exe", "utf8");
    const result = launchElevatedUpdateApply({
      scriptPath: missingScript,
      sourcePath: source,
      elevated: true,
      programDataRoot: dir,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /update-agent\.ps1/i);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("handleUpdateApply maps missing package to ok:false (no empty success)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-elev-api-"));
  const prevPd = process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  try {
    await mkdir(join(dir, "updates"), { recursive: true });
    const res = handleUpdateApply();
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(typeof res.error, "string");
      assert.ok(res.error.length > 0);
    }
    assert.equal(ELEVATION_REQUIRED, "ELEVATION_REQUIRED");
    writeApplyRequest(
      {
        source: join(dir, "x.exe"),
        script: join(dir, "u.ps1"),
        requestedAt: new Date().toISOString(),
      },
      dir,
    );
    assert.equal(existsSync(resolveApplyRequestPath(dir)), true);
  } finally {
    if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevPd;
    await rm(dir, { recursive: true, force: true });
  }
});
