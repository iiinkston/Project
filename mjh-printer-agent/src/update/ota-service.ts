import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../logger.js";
import { AGENT_VERSION } from "../version.js";
import {
  compareVersions,
  handleUpdateApply,
  handleUpdateCheck,
  resolveStagedUpdateExe,
  resolveUpdatesDir,
} from "../local/update.js";
import type {
  LocalOkResponse,
  LocalErrorResponse,
  LocalUpdateCheckResponse,
  LocalUpdateStatusResponse,
} from "../local/types.js";
import { isOtaRemoteEnabled, loadOtaConfig } from "./ota-config.js";
import { fetchRemoteUpdateManifest } from "./ota-manifest.js";
import { downloadAndStageUpdate } from "./ota-download.js";
import { readOtaState, writeOtaState } from "./ota-state.js";

let downloadInFlight: Promise<LocalOkResponse | LocalErrorResponse> | null = null;

/**
 * Local check + optional remote manifest probe (does not download).
 */
export async function handleOtaUpdateCheck(): Promise<LocalUpdateCheckResponse> {
  const local = handleUpdateCheck();
  const config = loadOtaConfig();

  if (!isOtaRemoteEnabled(config)) {
    logger.info(
      `OTA CHECK current=${local.currentVersion} latest=${local.latestVersion} (local only)`,
      "OTA",
    );
    return local;
  }

  try {
    const remote = await fetchRemoteUpdateManifest();
    if (!remote) {
      return local;
    }

    const latestVersion = remote.agentVersion;
    const updateAvailable = compareVersions(latestVersion, AGENT_VERSION) > 0;
    const staged = resolveStagedUpdateExe();
    const previous = readOtaState();
    const downloaded =
      Boolean(staged) &&
      previous.downloadedVersion === latestVersion &&
      updateAvailable;

    writeOtaState({
      lastCheckAt: new Date().toISOString(),
      lastError: null,
      remoteVersion: latestVersion,
      remoteNotes: remote.releaseNotes?.trim() || null,
      remoteSha256: remote.sha256,
      remoteUrl: remote.agentUrl,
      mandatory: Boolean(remote.mandatory),
      ready: downloaded,
      downloadedVersion: downloaded ? previous.downloadedVersion : previous.downloadedVersion,
      downloadedSha256: downloaded ? previous.downloadedSha256 : previous.downloadedSha256,
    });

    logger.info(
      `OTA CHECK current=${AGENT_VERSION} latest=${latestVersion} available=${updateAvailable}`,
      "OTA",
    );

    return {
      currentVersion: AGENT_VERSION,
      latestVersion: updateAvailable || local.updateAvailable ? latestVersion : AGENT_VERSION,
      updateAvailable: updateAvailable || local.updateAvailable,
      notes: remote.releaseNotes?.trim() || local.notes,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeOtaState({
      lastCheckAt: new Date().toISOString(),
      lastError: message.slice(0, 240),
    });
    logger.warn(`OTA CHECK failed: ${message}`, "OTA");
    return local;
  }
}

export function handleOtaUpdateStatus(): LocalUpdateStatusResponse {
  const local = handleUpdateCheck();
  const state = readOtaState();
  const config = loadOtaConfig();
  const remoteEnabled = isOtaRemoteEnabled(config);

  const latestFromRemote = state.remoteVersion?.trim() || null;
  const latestVersion =
    latestFromRemote && compareVersions(latestFromRemote, local.latestVersion) > 0
      ? latestFromRemote
      : local.latestVersion;

  const updateAvailable = compareVersions(latestVersion, AGENT_VERSION) > 0;
  const staged = resolveStagedUpdateExe();
  const downloaded =
    Boolean(staged) &&
    updateAvailable &&
    (state.downloadedVersion === latestVersion ||
      (existsSync(join(resolveUpdatesDir(), "manifest.json")) &&
        local.updateAvailable &&
        local.latestVersion === latestVersion));

  const ready = Boolean(downloaded && updateAvailable);

  return {
    currentVersion: AGENT_VERSION,
    latestVersion: updateAvailable ? latestVersion : AGENT_VERSION,
    updateAvailable,
    downloaded: ready,
    ready,
    notes: state.remoteNotes || local.notes,
    mandatory: state.mandatory,
    lastCheckAt: state.lastCheckAt,
    lastError: state.lastError,
    remoteEnabled,
  };
}

export async function handleOtaUpdateDownload(): Promise<LocalOkResponse | LocalErrorResponse> {
  if (downloadInFlight) {
    return downloadInFlight;
  }

  downloadInFlight = (async () => {
    const config = loadOtaConfig();
    if (!isOtaRemoteEnabled(config)) {
      return {
        ok: false,
        error: "远程 OTA 未启用（请配置 config/update.json 的 enabled 与 manifestUrl）",
      };
    }

    try {
      const remote = await fetchRemoteUpdateManifest();
      if (!remote) {
        return { ok: false, error: "无法获取远程更新清单" };
      }

      writeOtaState({
        lastCheckAt: new Date().toISOString(),
        lastError: null,
        remoteVersion: remote.agentVersion,
        remoteNotes: remote.releaseNotes?.trim() || null,
        remoteSha256: remote.sha256,
        remoteUrl: remote.agentUrl,
        mandatory: Boolean(remote.mandatory),
      });

      if (compareVersions(remote.agentVersion, AGENT_VERSION) <= 0) {
        logger.info(
          `OTA DOWNLOAD ignored (no downgrade/same) current=${AGENT_VERSION} remote=${remote.agentVersion}`,
          "OTA",
        );
        return { ok: false, error: "当前已是最新版本（已忽略同版本或降级）" };
      }

      const result = await downloadAndStageUpdate(remote);
      if (!result.ok) {
        writeOtaState({
          lastError: result.error.slice(0, 240),
          ready: false,
        });
        return { ok: false, error: result.error };
      }

      writeOtaState({
        downloadedVersion: result.version,
        downloadedSha256: result.sha256,
        ready: true,
        lastError: null,
      });
      return {
        ok: true,
        message: `已下载 ${result.version}，可安装更新`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeOtaState({ lastError: message.slice(0, 240), ready: false });
      logger.error(`UPDATE FAILED ${message}`, "OTA");
      return { ok: false, error: message };
    }
  })();

  try {
    return await downloadInFlight;
  } finally {
    downloadInFlight = null;
  }
}

/** Apply staged package via existing update-agent.ps1 (unchanged). */
export function handleOtaUpdateApply(): LocalOkResponse | LocalErrorResponse {
  const status = handleOtaUpdateStatus();
  if (!status.ready && !status.updateAvailable) {
    return { ok: false, error: "没有可安装的更新包" };
  }
  if (!resolveStagedUpdateExe()) {
    return { ok: false, error: "更新包尚未下载完成" };
  }
  logger.info("OTA APPLY via update-agent.ps1", "OTA");
  return handleUpdateApply();
}

/**
 * Background: check + download only. Never applies (does not interrupt printing).
 */
export async function runOtaBackgroundTick(): Promise<void> {
  const config = loadOtaConfig();
  if (!isOtaRemoteEnabled(config)) {
    return;
  }
  try {
    const check = await handleOtaUpdateCheck();
    if (!check.updateAvailable) {
      return;
    }
    const status = handleOtaUpdateStatus();
    if (status.ready) {
      return;
    }
    logger.info("OTA scheduler downloading in background", "OTA");
    await handleOtaUpdateDownload();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`OTA scheduler tick failed: ${message}`, "OTA");
  }
}
