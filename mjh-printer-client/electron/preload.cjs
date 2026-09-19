const { contextBridge } = require("electron");

/** Renderer only talks to Agent via fetch(127.0.0.1) — no privileged APIs. */
contextBridge.exposeInMainWorld("mjhDesktop", {
  platform: process.platform,
});
