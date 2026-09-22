const { contextBridge, ipcRenderer } = require("electron");

/** Renderer talks to Agent via fetch(127.0.0.1); Client OTA via IPC only. */
contextBridge.exposeInMainWorld("mjhDesktop", {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("mjh:get-version"),
  log: (message) => ipcRenderer.invoke("mjh:log", String(message ?? "").slice(0, 500)),
  clientUpdateCheck: () => ipcRenderer.invoke("client:update:check"),
  clientUpdateDownload: () => ipcRenderer.invoke("client:update:download"),
  clientUpdateApply: () => ipcRenderer.invoke("client:update:apply"),
  onNavigate: (callback) => {
    const handler = (_event, tab) => {
      if (typeof callback === "function") callback(tab);
    };
    ipcRenderer.on("mjh:navigate", handler);
    return () => ipcRenderer.removeListener("mjh:navigate", handler);
  },
});
