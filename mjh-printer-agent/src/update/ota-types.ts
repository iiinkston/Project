import { z } from "zod";

/** Remote OTA manifest published by your update API / CDN index. */
export const remoteUpdateManifestSchema = z.object({
  channel: z.string().min(1).optional(),
  agentVersion: z.string().min(1),
  agentUrl: z.string().url(),
  sha256: z.string().min(16),
  releaseNotes: z.string().optional().nullable(),
  mandatory: z.boolean().optional().default(false),
});

export type RemoteUpdateManifest = z.infer<typeof remoteUpdateManifestSchema>;

export const otaConfigSchema = z.object({
  enabled: z.boolean().default(false),
  channel: z.string().min(1).default("stable"),
  manifestUrl: z.string().default(""),
  checkIntervalMinutes: z.number().int().positive().default(360),
});

export type OtaConfig = z.infer<typeof otaConfigSchema>;

export type OtaPersistedState = {
  lastCheckAt: string | null;
  lastError: string | null;
  remoteVersion: string | null;
  remoteNotes: string | null;
  remoteSha256: string | null;
  remoteUrl: string | null;
  mandatory: boolean;
  downloadedVersion: string | null;
  downloadedSha256: string | null;
  ready: boolean;
};
