import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

function defaultProgramDataRoot(): string {
  return process.env.ProgramData && process.env.ProgramData.length > 0
    ? join(process.env.ProgramData, "MJH Printer Agent")
    : join("C:\\ProgramData", "MJH Printer Agent");
}

const PROGRAM_FILES_ROOT =
  process.env["ProgramFiles"] && process.env["ProgramFiles"].length > 0
    ? join(process.env["ProgramFiles"], "MJH Printer Agent")
    : join("C:\\Program Files", "MJH Printer Agent");

export type RuntimePaths = {
  configPath: string;
  dataDir: string;
  logsDir: string;
  statePath: string;
  lockPath: string;
  statusPath: string;
  installDir: string;
  programDataRoot: string;
};

export function isPackagedRuntime(): boolean {
  const proc = process as NodeJS.Process & { pkg?: unknown };
  return Boolean(proc.pkg) || process.env.MJH_PACKAGED === "1";
}

/** Absolute ProgramData override for smoke/tests (`MJH_PROGRAMDATA_DIR`). */
export function resolveProgramDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.MJH_PROGRAMDATA_DIR?.trim();
  if (override) {
    return isAbsolute(override) ? override : join(process.cwd(), override);
  }
  // Legacy: MJH_FORCE_PROGRAMDATA=1 forces default ProgramData (boolean).
  // If value looks like a path, treat as override too.
  const force = env.MJH_FORCE_PROGRAMDATA?.trim();
  if (force && force !== "1" && force.toLowerCase() !== "true" && /[\\/]/.test(force)) {
    return isAbsolute(force) ? force : join(process.cwd(), force);
  }
  return defaultProgramDataRoot();
}

export function getProjectRoot(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    if (here.endsWith(`${join("dist")}`) || here.replace(/\\/g, "/").endsWith("/dist")) {
      return join(here, "..");
    }
    if (here.includes(`${join("src")}`)) {
      return join(here, "..");
    }
    return join(here, "..");
  } catch {
    return process.cwd();
  }
}

/** Directory containing the running EXE (or project root in dev). */
export function getExecutableDir(): string {
  if (isPackagedRuntime()) {
    return dirname(process.execPath);
  }
  return getProjectRoot();
}

function firstExisting(...candidates: string[]): string | undefined {
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  return undefined;
}

/**
 * Config lookup order:
 * 1. MJH_CONFIG_PATH
 * 2. ProgramData config
 * 3. EXE-side config/printer.json
 * 4. Development project config
 */
export function resolveConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MJH_CONFIG_PATH && env.MJH_CONFIG_PATH.trim()) {
    return env.MJH_CONFIG_PATH.trim();
  }

  const programDataRoot = resolveProgramDataRoot(env);
  const programDataConfig = join(programDataRoot, "config", "printer.json");
  const exeSideConfig = join(getExecutableDir(), "config", "printer.json");
  const projectConfig = join(getProjectRoot(), "config", "printer.json");

  const found = firstExisting(programDataConfig, exeSideConfig, projectConfig);
  return found ?? programDataConfig;
}

export function resolveRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const configPath = resolveConfigPath(env);
  const programDataRoot = resolveProgramDataRoot(env);
  const hasOverride = Boolean(env.MJH_PROGRAMDATA_DIR?.trim());
  const useProgramData =
    hasOverride ||
    configPath.replace(/\\/g, "/").includes("/MJH Printer Agent/") ||
    configPath.toLowerCase().includes("programdata") ||
    Boolean(env.MJH_FORCE_PROGRAMDATA) ||
    isPackagedRuntime();

  const dataDir = useProgramData
    ? join(programDataRoot, "data")
    : env.MJH_DATA_DIR
      ? env.MJH_DATA_DIR
      : join(getProjectRoot(), "data");
  const logsDir = useProgramData
    ? join(programDataRoot, "logs")
    : join(getProjectRoot(), "logs");

  void homedir;

  return {
    configPath,
    dataDir,
    logsDir,
    statePath: join(dataDir, "print-state.json"),
    lockPath: join(dataDir, "agent.lock"),
    statusPath: join(dataDir, "status.json"),
    installDir: isPackagedRuntime() ? getExecutableDir() : PROGRAM_FILES_ROOT,
    programDataRoot,
  };
}

export function getProgramDataRoot(): string {
  return resolveProgramDataRoot();
}

export function getProgramFilesRoot(): string {
  return PROGRAM_FILES_ROOT;
}
