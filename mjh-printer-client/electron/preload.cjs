const { contextBridge, ipcRenderer } = require("electron");

/** Renderer only talks to Agent via fetch(127.0.0.1) — no privileged APIs. */
contextBridge.exposeInMainWorld("mjhDesktop", {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("mjh:get-version"),
  log: (message) => ipcRenderer.invoke("mjh:log", String(message ?? "").slice(0, 500)),
  onNavigate: (callback) => {
    const handler = (_event, tab) => {
      if (typeof callback === "function") callback(tab);
    };
    ipcRenderer.on("mjh:navigate", handler);
    return () => ipcRenderer.removeListener("mjh:navigate", handler);
  },
});
