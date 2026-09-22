const { app, BrowserWindow, shell, Tray, Menu, nativeImage, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { createClientUpdateService } = require("./client-update-service.cjs");
const {
  formatAppStartLog,
  formatRendererCrashLog,
  formatRendererRecoveryLog,
  formatSecondInstanceLog,
  planRendererRecovery,
} = require("./stability-lib.cjs");

/** Fallback tiny 16×16 green circle PNG (base64). */
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNgGJRAPj/6PzZMtkaiDaLIAGI14zRk1AAqGDBw6YAYgwhqHBAAAKU57GEi2ZsrAAAAAElFTkSuQmCC";

// Restaurant PCs: GPU drivers / RDP often crash Chromium GPU → blank window.
try {
  app.disableHardwareAcceleration();
} catch {
  // ignore
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let tray = null;
let clientUpdate = null;
let pendingShowFromSecondInstance = false;
let rendererRecoveryState = { recoveryCount: 0 };
app.isQuitting = false;

function clientLogDir() {
  // %APPDATA%\MJH Printer Client\logs
  return path.join(app.getPath("appData"), "MJH Printer Client", "logs");
}

function clientLogPath() {
  return path.join(clientLogDir(), "client.log");
}

function logLine(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    fs.mkdirSync(clientLogDir(), { recursive: true });
    fs.appendFileSync(clientLogPath(), line, "utf8");
  } catch {
    // ignore logging failures
  }
  console.log(`[mjh] ${message}`);
}

function resolveRendererHtml() {
  const candidates = [
    // Packaged: electron/ and dist/ sit side-by-side inside app.asar
    path.join(__dirname, "..", "dist", "index.html"),
    path.join(__dirname, "dist", "index.html"),
    // Dev / unpacked fallbacks
    path.join(app.getAppPath(), "dist", "index.html"),
    path.join(process.resourcesPath || "", "app.asar", "dist", "index.html"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      // continue
    }
  }
  return candidates[0];
}

function loadTrayIcon() {
  const iconPath = path.join(__dirname, "tray-icon.png");
  if (fs.existsSync(iconPath)) {
    const fromFile = nativeImage.createFromPath(iconPath);
    if (!fromFile.isEmpty()) return fromFile;
  }
  return nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
  }
}

function navigateTo(tab) {
  showMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("mjh:navigate", tab);
  }
}

async function trayTestPrint() {
  try {
    const res = await fetch("http://127.0.0.1:17890/local/printer/test", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
    const text = await res.text();
    logLine(`tray test-print → ${res.status} ${text.slice(0, 200)}`);
  } catch (err) {
    logLine(`tray test-print failed ${err}`);
  }
}

async function trayCheckUpdate() {
  navigateTo("settings");
  try {
    const res = await fetch("http://127.0.0.1:17890/local/update/check", {
      headers: { Accept: "application/json" },
    });
    const text = await res.text();
    logLine(`tray update-check → ${res.status} ${text.slice(0, 200)}`);
  } catch (err) {
    logLine(`tray update-check failed ${err}`);
  }
}

function createTray() {
  const icon = loadTrayIcon();
  // Never use createEmpty() — empty Tray can crash Electron on some Windows GPUs.
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(TRAY_ICON_DATA_URL) : icon);
  tray.setToolTip("满江红打印助手");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开控制台",
      click: () => showMainWindow(),
    },
    {
      label: "测试打印",
      click: () => void trayTestPrint(),
    },
    {
      label: "查看状态",
      click: () => {
        navigateTo("dashboard");
      },
    },
    {
      label: "检查更新",
      click: () => void trayCheckUpdate(),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => toggleMainWindow());
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: "满江红打印助手",
    backgroundColor: "#f4f6f8",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("close", (e) => {
    if (app.isQuitting) return;
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", (_e, code, desc, url) => {
    logLine(`fail-load code=${code} desc=${desc} url=${url}`);
  });

  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    const plan = planRendererRecovery(rendererRecoveryState, {
      isQuitting: Boolean(app.isQuitting),
      windowAlive: Boolean(mainWindow && !mainWindow.isDestroyed()),
    });
    rendererRecoveryState = {
      recoveryCount: plan.recoveryCount,
      lastRecoveryAt: plan.lastRecoveryAt,
    };

    logLine(
      formatRendererCrashLog({
        reason: details.reason,
        exitCode: details.exitCode,
        recoveryCount: plan.recoveryCount,
        version: app.getVersion(),
      }),
    );

    if (!plan.shouldReload) return;

    setTimeout(() => {
      if (app.isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
      logLine(
        formatRendererRecoveryLog({
          recoveryCount: rendererRecoveryState.recoveryCount,
          version: app.getVersion(),
        }),
      );
      try {
        mainWindow.webContents.reloadIgnoringCache();
      } catch (err) {
        logLine(`renderer recovery reload failed ${err}`);
      }
    }, 500);
  });

  mainWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
    if (level >= 2) {
      logLine(`renderer console[${level}] ${message} (${sourceId}:${line})`);
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    logLine(`loadURL dev=${devUrl}`);
    void mainWindow.loadURL(devUrl);
  } else {
    const htmlPath = resolveRendererHtml();
    logLine(`renderer path=${htmlPath} exists=${fs.existsSync(htmlPath)}`);
    logLine(`__dirname=${__dirname} appPath=${app.getAppPath()}`);
    logLine(`loadFile ${htmlPath}`);
    void mainWindow.loadFile(htmlPath).catch((err) => {
      logLine(`loadFile error ${err}`);
    });
  }
}

function configureAutoLaunch() {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      path: process.execPath,
      args: ["--tray"],
    });
  } catch (err) {
    logLine(`setLoginItemSettings failed ${err}`);
  }
}

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    logLine(formatSecondInstanceLog({ version: app.getVersion() }));
    if (!mainWindow || mainWindow.isDestroyed()) {
      pendingShowFromSecondInstance = true;
      return;
    }
    showMainWindow();
  });
}

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;

  logLine(
    formatAppStartLog({
      version: app.getVersion(),
      execPath: process.execPath,
      hardwareAcceleration: false,
      singleInstance: true,
    }),
  );
  logLine(`app ready version=${app.getVersion()} exec=${process.execPath}`);

  configureAutoLaunch();
  clientUpdate = createClientUpdateService({ app, log: logLine });
  // Seed default Client OTA config once (disabled until manifestUrl is set).
  try {
    const cfg = clientUpdate.configPath();
    if (!fs.existsSync(cfg)) {
      const template = path.join(__dirname, "..", "config", "client-update.json");
      fs.mkdirSync(path.dirname(cfg), { recursive: true });
      if (fs.existsSync(template)) {
        fs.copyFileSync(template, cfg);
      } else {
        fs.writeFileSync(
          cfg,
          `${JSON.stringify(
            {
              enabled: false,
              channel: "stable",
              manifestUrl: "",
              checkIntervalMinutes: 360,
            },
            null,
            2,
          )}\n`,
          "utf8",
        );
      }
      logLine(`seeded client OTA config ${cfg}`);
    }
  } catch (err) {
    logLine(`seed client OTA config failed ${err}`);
  }
  createWindow();
  createTray();
  const startInTray = process.argv.includes("--tray");
  if (startInTray && mainWindow) {
    mainWindow.hide();
  }
  if (pendingShowFromSecondInstance) {
    pendingShowFromSecondInstance = false;
    showMainWindow();
  }
  ipcMain.on("mjh:show-window", () => showMainWindow());
  ipcMain.handle("mjh:get-version", () => app.getVersion());
  ipcMain.handle("mjh:log", (_event, message) => {
    const text = String(message ?? "")
      .replace(/("token"\s*:\s*")[^"]*"/gi, '$1***')
      .slice(0, 500);
    logLine(text);
  });
  ipcMain.handle("client:update:check", async () => {
    if (!clientUpdate) throw new Error("client update service not ready");
    return clientUpdate.check();
  });
  ipcMain.handle("client:update:download", async () => {
    if (!clientUpdate) throw new Error("client update service not ready");
    return clientUpdate.download();
  });
  ipcMain.handle("client:update:apply", async () => {
    if (!clientUpdate) throw new Error("client update service not ready");
    const result = await clientUpdate.apply();
    // Only quit after an update task/process was actually accepted.
    // Non-elevated: ok=false + elevationStarted + quitting — not fake success.
    const accepted =
      (result.ok === true && result.quitting) ||
      (result.elevationStarted === true && result.quitting);
    if (accepted) {
      logLine(
        `CLIENT OTA APPLY accepted mode=${result.mode || "?"} quitting — installer owns restart`,
      );
      // Give schtasks/UAC a moment to attach before this process exits (not a success sleep).
      setTimeout(() => {
        app.isQuitting = true;
        app.quit();
      }, 1500);
    }
    return result;
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("window-all-closed", () => {
  // Keep running in tray — do not quit when window is hidden.
});
