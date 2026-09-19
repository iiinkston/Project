import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveConfigPath, resolveRuntimePaths } from "./paths.js";

test("config precedence honors MJH_CONFIG_PATH", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-paths-"));
  const cfg = join(dir, "printer.json");
  await writeFile(cfg, "{}");
  const prev = process.env.MJH_CONFIG_PATH;
  process.env.MJH_CONFIG_PATH = cfg;
  try {
    assert.equal(resolveConfigPath(), cfg);
  } finally {
    if (prev === undefined) delete process.env.MJH_CONFIG_PATH;
    else process.env.MJH_CONFIG_PATH = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("ProgramData path resolution with MJH_FORCE_PROGRAMDATA", async () => {
  const prev = process.env.MJH_FORCE_PROGRAMDATA;
  const prevDir = process.env.MJH_PROGRAMDATA_DIR;
  delete process.env.MJH_PROGRAMDATA_DIR;
  process.env.MJH_FORCE_PROGRAMDATA = "1";
  try {
    const paths = resolveRuntimePaths();
    assert.ok(paths.dataDir.toLowerCase().includes("programdata") || paths.dataDir.includes("MJH Printer Agent"));
    assert.ok(paths.logsDir.includes("logs"));
    assert.ok(paths.statusPath.endsWith("status.json"));
  } finally {
    if (prev === undefined) delete process.env.MJH_FORCE_PROGRAMDATA;
    else process.env.MJH_FORCE_PROGRAMDATA = prev;
    if (prevDir === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prevDir;
  }
});

test("MJH_PROGRAMDATA_DIR overrides ProgramData root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mjh-pd-"));
  const prev = process.env.MJH_PROGRAMDATA_DIR;
  const prevForce = process.env.MJH_FORCE_PROGRAMDATA;
  process.env.MJH_PROGRAMDATA_DIR = dir;
  delete process.env.MJH_FORCE_PROGRAMDATA;
  try {
    const paths = resolveRuntimePaths();
    assert.equal(paths.programDataRoot, dir);
    assert.ok(paths.dataDir.startsWith(dir));
    assert.ok(paths.logsDir.startsWith(dir));
  } finally {
    if (prev === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
    else process.env.MJH_PROGRAMDATA_DIR = prev;
    if (prevForce === undefined) delete process.env.MJH_FORCE_PROGRAMDATA;
    else process.env.MJH_FORCE_PROGRAMDATA = prevForce;
    await rm(dir, { recursive: true, force: true });
  }
});
