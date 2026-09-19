const { app, BrowserWindow, shell, Tray, Menu, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

/** Fallback tiny 16×16 green circle PNG (base64). */
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAALUlEQVR4nGNgGJRAPj/6PzZMtkaiDaLIAGI14zRk1AAqGDBw6YAYgwhqHBAAAKU57GEi2ZsrAAAAAElFTkSuQmCC";

let mainWindow = null;
let tray = null;
app.isQuitting = false;

function loadTrayIcon() {
  const iconPath = path.join(__dirname, "tray-icon.png");
  if (fs.existsSync(iconPath)) {
    const fromFile = nativeImage.createFromPath(iconPath);
    if (!fromFile.isEmpty()) return fromFile;
  }
  return nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
}

function showMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showMainWindow();
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
    console.log(`[mjh] tray test-print → ${res.status} ${text.slice(0, 200)}`);
  } catch (err) {
    console.error("[mjh] tray test-print failed", err);
  }
}

function createTray() {
  const icon = loadTrayIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("满江红打印助手");

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "打开打印助手",
      click: () => showMainWindow(),
    },
    {
      label: "测试打印",
      click: () => void trayTestPrint(),
    },
    {
      label: "查看状态",
      click: () => showMainWindow(),
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
    console.error(`[mjh] fail-load ${code} ${desc} ${url}`);
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  const startInTray = process.argv.includes("--tray");
  if (startInTray && mainWindow) {
    mainWindow.hide();
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showMainWindow();
  });
});

app.on("before-quit", () => {
  app.isQuitting = true;
});

app.on("window-all-closed", () => {
  // Keep running in tray on Windows/Linux; macOS already keeps dock apps alive.
  if (process.platform === "darwin" && !app.isQuitting) return;
  // Do not quit when window is hidden to tray.
});
