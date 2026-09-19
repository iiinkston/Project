import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { getProjectRoot, resolveConfigPath as resolveConfigPathFromPaths, resolveRuntimePaths } from "./paths.js";
import { AGENT_VERSION } from "./version.js";

export type TokenSource = "config" | "env";

export type ResolvedToken = {
  token: string;
  source: TokenSource;
};

const fileConfigSchema = z.object({
  store: z.object({
    id: z.string().min(1),
    /** Display name from pairing — safe to show in Local API. */
    name: z.string().optional(),
  }),
  agent: z.object({
    id: z.string().min(1),
    token: z.preprocess(
      (value) => (value === "" ? null : value),
      z.string().min(1).nullable().optional(),
    ),
    pollIntervalMs: z.number().int().positive(),
  }),
  printer: z.object({
    name: z.string().min(1),
    model: z.string().min(1),
    ip: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    encoding: z.literal("gb18030"),
    connectTimeoutMs: z.number().int().positive(),
  }),
  cloud: z.object({
    baseUrl: z.string().url(),
  }),
});

export type FileConfig = z.infer<typeof fileConfigSchema>;
export type PrinterConfig = FileConfig["printer"];
export type AppConfig = FileConfig & {
  cloud: FileConfig["cloud"] & {
    token: string;
    requestTimeoutMs: number;
  };
  version: string;
  configPath: string;
  dataDir: string;
  logsDir: string;
};

export const TOKEN_ENV = "MJH_PRINTER_AGENT_TOKEN";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function resolveConfigPath(): string {
  return resolveConfigPathFromPaths();
}

export function resolveDataDir(): string {
  return resolveRuntimePaths().dataDir;
}

export function resolveStatePath(): string {
  return resolveRuntimePaths().statePath;
}

export function resolveLockPath(): string {
  return resolveRuntimePaths().lockPath;
}

export function resolveStatusPath(): string {
  return resolveRuntimePaths().statusPath;
}

export function resolveLogsDir(): string {
  return resolveRuntimePaths().logsDir;
}

export function readPackageVersion(): string {
  try {
    const raw = readFileSync(join(getProjectRoot(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? AGENT_VERSION;
  } catch {
    return AGENT_VERSION;
  }
}

function readFileConfig(configPath: string): FileConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read printer config at ${configPath}: ${detail}`);
  }

  // PowerShell Set-Content -Encoding UTF8 writes BOM; strip so JSON/token stay valid.
  if (raw.charCodeAt(0) === 0xfeff) {
    raw = raw.slice(1);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in printer config ${configPath}: ${detail}`);
  }

  const parsed = fileConfigSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Printer config validation failed: ${issues}`);
  }

  return parsed.data;
}

export function loadFileConfig(configPath: string = resolveConfigPath()): FileConfig {
  return readFileConfig(configPath);
}

export function resolveAgentTokenDetails(
  file: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedToken {
  const fromConfig = file.agent.token?.trim();
  if (fromConfig) {
    return { token: fromConfig, source: "config" };
  }

  const fromEnv = env[TOKEN_ENV]?.trim();
  if (fromEnv) {
    return { token: fromEnv, source: "env" };
  }

  throw new Error(
    `Missing printer-agent token. Set agent.token in printer.json or ${TOKEN_ENV}.`,
  );
}

export function resolveAgentToken(
  file: FileConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveAgentTokenDetails(file, env).token;
}

/** Token source for an already-loaded AppConfig (config wins over env). */
export function resolveAgentTokenSource(
  config: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): TokenSource {
  const fromConfig = config.agent.token?.trim();
  if (fromConfig) {
    return "config";
  }
  if (env[TOKEN_ENV]?.trim()) {
    return "env";
  }
  return "config";
}

export function hashTokenSha256(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function loadConfig(configPath: string = resolveConfigPath()): AppConfig {
  const paths = resolveRuntimePaths();
  const resolvedPath = configPath || paths.configPath;
  const file = readFileConfig(resolvedPath);
  const { token } = resolveAgentTokenDetails(file);

  return {
    ...file,
    version: readPackageVersion(),
    configPath: resolvedPath,
    dataDir: paths.dataDir,
    logsDir: paths.logsDir,
    cloud: {
      ...file.cloud,
      token,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    },
  };
}

export function hasTokenConfigured(file: FileConfig, env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    resolveAgentTokenDetails(file, env);
    return true;
  } catch {
    return false;
  }
}
