const fs = require("fs");
const path = require("path");
const {
  ELEVATION_REQUIRED,
  CLIENT_UPDATE_TASK_NAME,
  launchElevatedClientUpdateApply,
  tryStartUpdateScheduledTask,
  isProcessElevated,
} = require("d:/Project/mjh-printer-client/electron/client-update-elevation.cjs");
const { createClientUpdateService } = require("d:/Project/mjh-printer-client/electron/client-update-service.cjs");

const out = { at: new Date().toISOString() };
out.isElevated = isProcessElevated();
out.taskExistsRun = tryStartUpdateScheduledTask(CLIENT_UPDATE_TASK_NAME);

const setup = path.join(process.env.LOCALAPPDATA, "MJH Printer Client", "updates", "MJH Printer Setup.exe");
const updScript = "d:\\\\Project\\\\mjh-printer-client\\\\scripts\\\\update-client.ps1";

// Simulate Apply service path for 1.0.7->1.0.8 with FIXED code
fs.writeFileSync(
  path.join(process.env.LOCALAPPDATA, "MJH Printer Client", "updates", "ota-state.json"),
  JSON.stringify({
    ready: true,
    downloadedVersion: "1.0.8",
    remoteSha256: null,
    lastCheckAt: new Date().toISOString(),
  }, null, 2)
);

const svc = createClientUpdateService({
  app: { getVersion: () => "1.0.7", getPath: () => process.env.LOCALAPPDATA },
  log: (m) => console.error("[log]", m),
  resolveUpdaterScript: () => updScript,
});

svc.apply().then((r) => {
  out.applyResult = r;
  out.expectedShape =
    r.ok === false &&
    r.code === "ELEVATION_REQUIRED" &&
    r.elevationStarted === true;
  fs.writeFileSync("d:/Project/docs/rc-reports/client-ota-real-upgrade/test1-apply-result.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}).catch((e) => {
  out.error = String(e);
  fs.writeFileSync("d:/Project/docs/rc-reports/client-ota-real-upgrade/test1-apply-result.json", JSON.stringify(out, null, 2));
  console.error(e);
  process.exit(1);
});
