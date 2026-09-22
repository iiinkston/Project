"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  SETUP_NAME,
  compareVersions,
  normalizeSha256,
  parseClientManifest,
  sha256File,
  loadOtaConfig,
  readJsonSafe,
  writeJson,
  downloadVerifiedFile,
} = require("./client-update-lib.cjs");
const {
  CLIENT_UPDATE_TASK_NAME,
  ELEVATION_REQUIRED,
  launchElevatedClientUpdateApply,
} = require("./client-update-elevation.cjs");

/**
 * @param {{
 *   app: import("electron").App,
 *   log: (msg: string) => void,
 *   resolveUpdaterScript?: () => string | null,
 *   isElevated?: () => boolean,
 *   tryScheduledTask?: () => boolean,
 *   startDirect?: Function,
 *   startUac?: Function,
 *   programDataRoot?: string,
 * }} deps
 */
function createClientUpdateService(deps) {
  const { app, log } = deps;
  let downloadInFlight = null;

  function localAppDataRoot() {
    // Electron has no app.getPath("localAppData"); use env / appData parent.
    const fromEnv = process.env.LOCALAPPDATA;
    if (fromEnv && fromEnv.trim()) return fromEnv.trim();
    try {
      return path.join(app.getPath("appData"), "..", "Local");
    } catch {
      return path.join(app.getPath("userData"), "..");
    }
  }

  function updatesDir() {
    return path.join(localAppDataRoot(), "MJH Printer Client", "updates");
  }

  function configPath() {
    return path.join(localAppDataRoot(), "MJH Printer Client", "config", "update.json");
  }

  function statePath() {
    return path.join(updatesDir(), "ota-state.json");
  }

  function stagedSetupPath() {
    return path.join(updatesDir(), SETUP_NAME);
  }

  function stagedManifestPath() {
    return path.join(updatesDir(), "manifest.json");
  }

  function emptyState() {
    return {
      lastCheckAt: null,
      lastError: null,
      remoteVersion: null,
      remoteNotes: null,
      remoteSha256: null,
      remoteUrl: null,
      downloadedVersion: null,
      ready: false,
    };
  }

  function readState() {
    return readJsonSafe(statePath(), emptyState());
  }

  function writeState(patch) {
    const next = { ...readState(), ...patch };
    writeJson(statePath(), next);
    return next;
  }

  function resolveUpdaterScript() {
    if (typeof deps.resolveUpdaterScript === "function") {
      const custom = deps.resolveUpdaterScript();
      if (custom) return custom;
    }
    const candidates = [
      path.join(process.resourcesPath || "", "updater", "update-client.ps1"),
      path.join(__dirname, "..", "scripts", "update-client.ps1"),
      path.join(__dirname, "update-client.ps1"),
    ];
    for (const p of candidates) {
      if (p && fs.existsSync(p)) return p;
    }
    return null;
  }

  async function fetchManifest(manifestUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      log(`CLIENT OTA CHECK url=${manifestUrl}`);
      const response = await fetch(manifestUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`manifest HTTP ${response.status}: ${text.slice(0, 180)}`);
      }
      let parsed;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("manifest returned non-JSON");
      }
      return parseClientManifest(parsed);
    } finally {
      clearTimeout(timer);
    }
  }

  async function check() {
    const currentVersion = app.getVersion();
    const config = loadOtaConfig(configPath());
    const state = readState();

    if (!config.enabled || !config.manifestUrl) {
      log(`CLIENT OTA CHECK current=${currentVersion} (remote disabled)`);
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        notes: null,
        remoteEnabled: false,
        ready: false,
        lastError: state.lastError,
      };
    }

    try {
      const remote = await fetchManifest(config.manifestUrl);
      const updateAvailable = compareVersions(remote.clientVersion, currentVersion) > 0;
      const setupPath = stagedSetupPath();
      const ready =
        updateAvailable &&
        fs.existsSync(setupPath) &&
        state.downloadedVersion === remote.clientVersion;

      writeState({
        lastCheckAt: new Date().toISOString(),
        lastError: null,
        remoteVersion: remote.clientVersion,
        remoteNotes: remote.releaseNotes,
        remoteSha256: remote.clientSha256,
        remoteUrl: remote.clientUrl,
        ready,
        downloadedVersion: ready ? state.downloadedVersion : state.downloadedVersion,
      });

      log(
        `CLIENT OTA CHECK current=${currentVersion} latest=${remote.clientVersion} available=${updateAvailable}`,
      );

      return {
        currentVersion,
        latestVersion: updateAvailable ? remote.clientVersion : currentVersion,
        updateAvailable,
        notes: remote.releaseNotes,
        remoteEnabled: true,
        ready,
        lastError: null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeState({
        lastCheckAt: new Date().toISOString(),
        lastError: message.slice(0, 240),
      });
      log(`CLIENT OTA CHECK failed: ${message}`);
      return {
        currentVersion,
        latestVersion: state.remoteVersion || currentVersion,
        updateAvailable: Boolean(
          state.remoteVersion && compareVersions(state.remoteVersion, currentVersion) > 0,
        ),
        notes: state.remoteNotes,
        remoteEnabled: true,
        ready: Boolean(state.ready),
        lastError: message.slice(0, 240),
      };
    }
  }

  async function download() {
    if (downloadInFlight) return downloadInFlight;

    downloadInFlight = (async () => {
      const currentVersion = app.getVersion();
      const config = loadOtaConfig(configPath());
      if (!config.enabled || !config.manifestUrl) {
        return {
          ok: false,
          ready: false,
          error: "Client OTA 未启用（请配置 LocalAppData\\MJH Printer Client\\config\\update.json）",
        };
      }

      try {
        const remote = await fetchManifest(config.manifestUrl);
        writeState({
          lastCheckAt: new Date().toISOString(),
          lastError: null,
          remoteVersion: remote.clientVersion,
          remoteNotes: remote.releaseNotes,
          remoteSha256: remote.clientSha256,
          remoteUrl: remote.clientUrl,
        });

        if (compareVersions(remote.clientVersion, currentVersion) <= 0) {
          log(
            `CLIENT OTA DOWNLOAD ignored (no downgrade/same) current=${currentVersion} remote=${remote.clientVersion}`,
          );
          return { ok: false, ready: false, error: "当前已是最新版本（已忽略同版本或降级）" };
        }

        log(`CLIENT OTA DOWNLOAD START version=${remote.clientVersion}`);
        const dest = stagedSetupPath();
        const result = await downloadVerifiedFile(
          remote.clientUrl,
          dest,
          remote.clientSha256,
        );

        writeJson(stagedManifestPath(), {
          clientVersion: remote.clientVersion,
          clientSha256: remote.clientSha256,
          releaseNotes: remote.releaseNotes,
          setupPath: SETUP_NAME,
        });

        writeState({
          downloadedVersion: remote.clientVersion,
          ready: true,
          lastError: null,
        });

        log(`CLIENT OTA DOWNLOAD SUCCESS version=${remote.clientVersion}`);
        log("CLIENT OTA READY");
        return {
          ok: true,
          ready: true,
          path: result.path,
          latestVersion: remote.clientVersion,
          message: `已下载 Client ${remote.clientVersion}，可安装更新`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeState({ ready: false, lastError: message.slice(0, 240) });
        log(`CLIENT OTA DOWNLOAD FAILED ${message}`);
        return { ok: false, ready: false, error: message };
      }
    })();

    try {
      return await downloadInFlight;
    } finally {
      downloadInFlight = null;
    }
  }

  async function apply() {
    const currentVersion = app.getVersion();
    const state = readState();
    const setupPath = stagedSetupPath();
    if (!fs.existsSync(setupPath)) {
      return { ok: false, error: "尚未下载安装包" };
    }
    if (!state.ready || !state.downloadedVersion) {
      return { ok: false, error: "更新包未就绪，请先下载" };
    }
    if (compareVersions(state.downloadedVersion, currentVersion) <= 0) {
      return { ok: false, error: "下载版本不高于当前版本" };
    }

    if (state.remoteSha256) {
      const actual = await sha256File(setupPath);
      if (actual !== normalizeSha256(state.remoteSha256)) {
        return { ok: false, error: "安装前 SHA256 校验失败" };
      }
    }

    const script = resolveUpdaterScript();
    if (!script) {
      return { ok: false, error: "未找到 update-client.ps1" };
    }

    const newVersion = state.downloadedVersion;
    log(
      `CLIENT OTA APPLY setup=${setupPath} script=${script} old=${currentVersion} new=${newVersion}`,
    );

    const launched = launchElevatedClientUpdateApply({
      scriptPath: script,
      setupPath,
      oldVersion: currentVersion,
      newVersion,
      ...(typeof deps.isElevated === "function"
        ? { elevated: deps.isElevated() }
        : {}),
      ...(typeof deps.tryScheduledTask === "function"
        ? { tryScheduledTask: deps.tryScheduledTask }
        : {}),
      ...(typeof deps.startDirect === "function" ? { startDirect: deps.startDirect } : {}),
      ...(typeof deps.startUac === "function" ? { startUac: deps.startUac } : {}),
      ...(deps.programDataRoot ? { programDataRoot: deps.programDataRoot } : {}),
    });

    if (!launched.ok) {
      log(`CLIENT OTA APPLY FAILED ${launched.error}`);
      writeState({ lastError: (launched.error || "").slice(0, 240) });
      return { ok: false, error: launched.error };
    }

    if (launched.mode === "direct") {
      log(`CLIENT OTA APPLY mode=direct pid=${launched.pid ?? ""}`);
      writeState({ lastError: null });
      return {
        ok: true,
        message: "Update started, application will restart",
        quitting: true,
        mode: "direct",
        pid: launched.pid ?? undefined,
      };
    }

    const via =
      launched.mode === "scheduled-task"
        ? `计划任务 ${launched.taskName || CLIENT_UPDATE_TASK_NAME}`
        : "UAC 提权";
    log(`CLIENT OTA APPLY ELEVATION_REQUIRED via=${launched.mode}`);
    writeState({
      lastError: `ELEVATION_REQUIRED via ${launched.mode}`,
    });
    return {
      ok: false,
      code: ELEVATION_REQUIRED,
      elevationStarted: true,
      mode: launched.mode,
      taskName: launched.taskName,
      pid: launched.pid,
      message: "Update started, application will restart",
      quitting: true,
      error: `ELEVATION_REQUIRED：已通过${via}启动提权更新（未在本进程完成安装，禁止视为成功）。`,
    };
  }

  return { check, download, apply, stagedSetupPath, updatesDir, configPath };
}

module.exports = { createClientUpdateService };
