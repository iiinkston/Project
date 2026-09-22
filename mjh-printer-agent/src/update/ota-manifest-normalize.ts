import { remoteUpdateManifestSchema, type RemoteUpdateManifest } from "./ota-types.js";

/**
 * Normalize Cloud nested `{ client, agent }` and flat
 * `{ agentVersion, agentUrl, sha256|agentSha256 }` into the Agent schema.
 */
export function normalizeRemoteAgentManifest(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = raw as Record<string, unknown>;
  const nested =
    o.agent && typeof o.agent === "object"
      ? (o.agent as Record<string, unknown>)
      : null;

  const sha =
    o.sha256 ??
    o.agentSha256 ??
    nested?.sha256 ??
    nested?.agentSha256;

  return {
    channel: o.channel ?? nested?.channel,
    agentVersion: o.agentVersion ?? nested?.version ?? nested?.agentVersion,
    agentUrl: o.agentUrl ?? nested?.url ?? nested?.agentUrl,
    sha256: typeof sha === "string" ? sha.trim().toLowerCase().replace(/^sha256:/i, "").replace(/\s+/g, "") : sha,
    releaseNotes: o.releaseNotes ?? nested?.releaseNotes ?? null,
    mandatory: o.mandatory ?? nested?.mandatory,
  };
}

export function parseRemoteAgentManifest(raw: unknown): RemoteUpdateManifest {
  const normalized = normalizeRemoteAgentManifest(raw);
  const ok = remoteUpdateManifestSchema.safeParse(normalized);
  if (!ok.success) {
    throw new Error(`invalid manifest: ${ok.error.message}`);
  }
  return ok.data;
}
