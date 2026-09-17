import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const fileConfigSchema = z.object({
  store: z.object({
    id: z.string().min(1),
  }),
  agent: z.object({
    id: z.string().min(1),
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
};

const TOKEN_ENV = "MJH_PRINTER_AGENT_TOKEN";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function resolveProjectRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..");
}

export function resolveConfigPath(): string {
  return join(resolveProjectRoot(), "config", "printer.json");
}

export function resolveDataDir(): string {
  return join(resolveProjectRoot(), "data");
}

export function resolveStatePath(): string {
  return join(resolveDataDir(), "print-state.json");
}

function readFileConfig(configPath: string): FileConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read printer config at ${configPath}: ${detail}`);
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

/** Load file config only (no API token). Safe for printer:test. */
export function loadFileConfig(configPath: string = resolveConfigPath()): FileConfig {
  return readFileConfig(configPath);
}

/** Load full agent config including MJH_PRINTER_AGENT_TOKEN. */
export function loadConfig(configPath: string = resolveConfigPath()): AppConfig {
  const file = readFileConfig(configPath);
  const token = process.env[TOKEN_ENV]?.trim();

  if (!token) {
    throw new Error(
      `Missing ${TOKEN_ENV}. Set it in the environment; do not put the API token in printer.json.`,
    );
  }

  return {
    ...file,
    cloud: {
      ...file.cloud,
      token,
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
    },
  };
}