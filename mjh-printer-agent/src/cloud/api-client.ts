import { claimJobResponseSchema, type ClaimJobResponse, type PrintJob } from "./types.js";
import { z } from "zod";

export type ApiClientOptions = {
  baseUrl: string;
  token: string;
  storeId: string;
  agentId: string;
  requestTimeoutMs: number;
};

export const cloudHealthSchema = z.object({
  status: z.string(),
  database: z.string().optional(),
  version: z.string().optional(),
  commit: z.string().optional(),
  environment: z.string().optional(),
});

export type CloudHealth = z.infer<typeof cloudHealthSchema>;

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly storeId: string;
  private readonly agentId: string;
  private readonly requestTimeoutMs: number;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.storeId = options.storeId;
    this.agentId = options.agentId;
    this.requestTimeoutMs = options.requestTimeoutMs;
  }

  async health(): Promise<CloudHealth> {
    const data = await this.requestJson<unknown>("GET", "/health");
    const parsed = cloudHealthSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid cloud health response: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  async claimJob(): Promise<PrintJob | null> {
    const data = await this.requestJson<unknown>("POST", "/printer/jobs/claim", {
      storeId: this.storeId,
      agentId: this.agentId,
    });

    const parsed = claimJobResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`Invalid claim response from cloud: ${parsed.error.message}`);
    }

    const response: ClaimJobResponse = parsed.data;
    return response.job;
  }

  async completeJob(jobId: string): Promise<void> {
    await this.requestJson("POST", `/printer/jobs/${encodeURIComponent(jobId)}/complete`, {
      agentId: this.agentId,
    });
  }

  async failJob(jobId: string, error: string): Promise<void> {
    await this.requestJson("POST", `/printer/jobs/${encodeURIComponent(jobId)}/fail`, {
      agentId: this.agentId,
      error,
    });
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: unknown = undefined;
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text) as unknown;
        } catch {
          throw new Error(
            `Cloud returned non-JSON response (HTTP ${response.status}) from ${method} ${path}`,
          );
        }
      }

      if (!response.ok) {
        let detail = text.slice(0, 200) || response.statusText;
        if (typeof parsed === "object" && parsed !== null) {
          const obj = parsed as Record<string, unknown>;
          if (typeof obj.message === "string") {
            detail = obj.message;
          } else if (
            typeof obj.error === "object" &&
            obj.error !== null &&
            typeof (obj.error as { message?: unknown }).message === "string"
          ) {
            detail = (obj.error as { message: string }).message;
          }
        }
        throw new Error(`Cloud API error HTTP ${response.status} on ${method} ${path}: ${detail}`);
      }

      return parsed as T;
    } catch (error) {
      throw this.toFriendlyError(error, method, path);
    } finally {
      clearTimeout(timer);
    }
  }

  private toFriendlyError(error: unknown, method: string, path: string): Error {
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        return new Error(
          `Cloud request timed out after ${this.requestTimeoutMs}ms (${method} ${path})`,
        );
      }

      const code =
        "code" in error && typeof (error as NodeJS.ErrnoException).code === "string"
          ? (error as NodeJS.ErrnoException).code
          : undefined;

      if (code === "ECONNREFUSED") {
        return new Error(`Cloud API connection refused (${method} ${path})\n${error.message}`);
      }
      if (code === "ENOTFOUND") {
        return new Error(`Cloud API host not found (${method} ${path})\n${error.message}`);
      }
      if (code === "ENETUNREACH" || code === "EHOSTUNREACH") {
        return new Error(`Cloud API network unreachable (${method} ${path})\n${error.message}`);
      }

      if (
        error.message.startsWith("Cloud ") ||
        error.message.startsWith("Invalid claim") ||
        error.message.startsWith("Invalid cloud health")
      ) {
        return error;
      }

      return new Error(`Cloud request failed (${method} ${path})\n${error.message}`);
    }

    return new Error(`Cloud request failed (${method} ${path})\n${String(error)}`);
  }
}
