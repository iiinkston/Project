import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectRoot, resolveProgramDataRoot } from "../paths.js";
import { otaConfigSchema, type OtaConfig } from "./ota-types.js";

const DEFAULTS: OtaConfig = {
  enabled: false,
  channel: "stable",
  manifestUrl: "",
  checkIntervalMinutes: 360,
};

/**
 * Load OTA config (not printer.json). Lookup:
 * 1. MJH_UPDATE_CONFIG_PATH
 * 2. ProgramData\config\update.json
 * 3. EXE/project config/update.json
 */
export function resolveUpdateConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MJH_UPDATE_CONFIG_PATH?.trim()) {
    return env.MJH_UPDATE_CONFIG_PATH.trim();
  }
  const programData = join(resolveProgramDataRoot(env), "config", "update.json");
  if (existsSync(programData)) return programData;
  const project = join(getProjectRoot(), "config", "update.json");
  return project;
}

export function loadOtaConfig(env: NodeJS.ProcessEnv = process.env): OtaConfig {
  const path = resolveUpdateConfigPath(env);
  if (!existsSync(path)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const parsed = otaConfigSchema.safeParse(raw);
    if (!parsed.success) {
      return { ...DEFAULTS };
    }
    return parsed.data;
  } catch {
    return { ...DEFAULTS };
  }
}

export function isOtaRemoteEnabled(config: OtaConfig = loadOtaConfig()): boolean {
  return Boolean(config.enabled && config.manifestUrl.trim());
}
