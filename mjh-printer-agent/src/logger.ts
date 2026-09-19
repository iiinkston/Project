import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { WriteStream } from "node:fs";

export type LogLevel = "INFO" | "WARN" | "ERROR";

type LoggerOptions = {
  logsDir?: string;
  retentionDays?: number;
  alsoConsole?: boolean;
};

let fileStream: WriteStream | null = null;
let currentLogDate = "";
let logsDirectory: string | null = null;
let retentionDays = 14;
let alsoConsole = true;

function todayStamp(d = new Date()): string {
  const yyyy = d.getFullYear().toString().padStart(4, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ensureStream(): void {
  if (!logsDirectory) {
    return;
  }

  const stamp = todayStamp();
  if (fileStream && currentLogDate === stamp) {
    return;
  }

  if (fileStream) {
    fileStream.end();
    fileStream = null;
  }

  mkdirSync(logsDirectory, { recursive: true });
  const filePath = join(logsDirectory, `agent-${stamp}.log`);
  fileStream = createWriteStream(filePath, { flags: "a" });
  currentLogDate = stamp;
}

function redact(message: string): string {
  // Never allow accidental token dumps.
  return message
    .replace(/Bearer\s+[A-Za-z0-9+/=._-]+/gi, "Bearer ***")
    .replace(/"token"\s*:\s*"[^"]*"/gi, '"token":"***"');
}

function write(level: LogLevel, message: string, event?: string): void {
  const safe = redact(message);
  const line = event
    ? `${new Date().toISOString()} [${level}] [${event}] ${safe}`
    : `${new Date().toISOString()} [${level}] ${safe}`;

  if (alsoConsole) {
    if (level === "ERROR") {
      console.error(safe);
    } else if (level === "WARN") {
      console.warn(safe);
    } else {
      console.log(safe);
    }
  }

  try {
    ensureStream();
    fileStream?.write(`${line}\n`);
  } catch {
    // Ignore file log failures — console remains.
  }
}

export function configureLogger(options: LoggerOptions): void {
  logsDirectory = options.logsDir ?? null;
  retentionDays = options.retentionDays ?? 14;
  alsoConsole = options.alsoConsole ?? true;

  if (logsDirectory) {
    mkdirSync(logsDirectory, { recursive: true });
    pruneOldLogs();
    ensureStream();
  }
}

export function pruneOldLogs(): void {
  if (!logsDirectory || !existsSync(logsDirectory)) {
    return;
  }

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of readdirSync(logsDirectory)) {
    if (!/^agent-\d{4}-\d{2}-\d{2}\.log$/.test(name)) {
      continue;
    }
    const full = join(logsDirectory, name);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoff) {
        unlinkSync(full);
      }
    } catch {
      // ignore
    }
  }
}

export const logger = {
  info(message: string, event?: string): void {
    write("INFO", message, event);
  },
  warn(message: string, event?: string): void {
    write("WARN", message, event);
  },
  error(message: string, event?: string): void {
    write("ERROR", message, event);
  },
  event(event: string, message: string, level: LogLevel = "INFO"): void {
    write(level, message, event);
  },
};
