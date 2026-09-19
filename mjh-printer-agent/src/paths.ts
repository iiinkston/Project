import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const PROGRAM_DATA_ROOT =
  process.env.ProgramData && process.env.ProgramData.length > 0
    ? join(process.env.ProgramData, "MJH Printer Agent")
    : join("C:\\ProgramData", "MJH Printer Agent");

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

export function getProjectRoot(): string {
  // When bundled to CJS by esbuild, import.meta.url still works in our TS source
  // but after CJS bundle __dirname is used via define — see getBundleDir().
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // src/ → project root; dist/ → project root
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

  const programDataConfig = join(PROGRAM_DATA_ROOT, "config", "printer.json");
  const exeSideConfig = join(getExecutableDir(), "config", "printer.json");
  const projectConfig = join(getProjectRoot(), "config", "printer.json");

  // Prefer ProgramData when it exists (production), else first available.
  const found = firstExisting(programDataConfig, exeSideConfig, projectConfig);
  return found ?? programDataConfig;
}

export function resolveRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const configPath = resolveConfigPath(env);
  const useProgramData =
    configPath.replace(/\\/g, "/").includes("/MJH Printer Agent/") ||
    configPath.toLowerCase().includes("programdata") ||
    Boolean(env.MJH_FORCE_PROGRAMDATA) ||
    isPackagedRuntime();

  const dataRoot = useProgramData
    ? PROGRAM_DATA_ROOT
    : env.MJH_DATA_DIR
      ? env.MJH_DATA_DIR
      : join(getProjectRoot(), "data");

  // In development (non-packaged, config from project), keep data under project/data
  // unless MJH_FORCE_PROGRAMDATA is set.
  const dataDir = useProgramData
    ? join(PROGRAM_DATA_ROOT, "data")
    : join(getProjectRoot(), "data");
  const logsDir = useProgramData
    ? join(PROGRAM_DATA_ROOT, "logs")
    : join(getProjectRoot(), "logs");

  void dataRoot;
  void homedir;

  return {
    configPath,
    dataDir,
    logsDir,
    statePath: join(dataDir, "print-state.json"),
    lockPath: join(dataDir, "agent.lock"),
    statusPath: join(dataDir, "status.json"),
    installDir: isPackagedRuntime() ? getExecutableDir() : PROGRAM_FILES_ROOT,
    programDataRoot: PROGRAM_DATA_ROOT,
  };
}

export function getProgramDataRoot(): string {
  return PROGRAM_DATA_ROOT;
}

export function getProgramFilesRoot(): string {
  return PROGRAM_FILES_ROOT;
}
