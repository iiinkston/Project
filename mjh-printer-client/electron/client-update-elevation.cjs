"use strict";

const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const CLIENT_UPDATE_TASK_NAME = "MJH Printer Client Update";
const ELEVATION_REQUIRED = "ELEVATION_REQUIRED";

function isProcessElevated() {
  if (process.platform !== "win32") return true;
  try {
    execFileSync("net", ["session"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

function resolveProgramDataClientRoot() {
  const base = process.env.ProgramData || process.env.PROGRAMDATA || "C:\\ProgramData";
  return path.join(base, "MJH Printer Client");
}

function resolveApplyRequestPath(programDataRoot = resolveProgramDataClientRoot()) {
  return path.join(programDataRoot, "updates", "apply-request.json");
}

function writeApplyRequest(request, programDataRoot = resolveProgramDataClientRoot()) {
  const filePath = resolveApplyRequestPath(programDataRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
  return filePath;
}

function writeInstallerStartEvent(eventObj, programDataRoot = resolveProgramDataClientRoot()) {
  const filePath = path.join(programDataRoot, "updates", "installer-start.log");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(eventObj)}\n`, "utf8");
  return filePath;
}

function psSingleQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tryStartUpdateScheduledTask(taskName = CLIENT_UPDATE_TASK_NAME) {
  if (process.platform !== "win32") return false;
  try {
    execFileSync("schtasks.exe", ["/Run", "/TN", taskName], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15_000,
    });
    return true;
  } catch {
    return false;
  }
}

function startUpdateDirect(scriptPath, setupPath, oldVersion, newVersion) {
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-SetupPath",
    setupPath,
  ];
  if (oldVersion) args.push("-OldVersion", oldVersion);
  if (newVersion) args.push("-NewVersion", newVersion);
  const child = spawn("powershell.exe", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  return child.pid || null;
}

function startUpdateViaUacRunAs(scriptPath, setupPath, oldVersion, newVersion) {
  const argParts = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-SetupPath",
    setupPath,
  ];
  if (oldVersion) {
    argParts.push("-OldVersion", oldVersion);
  }
  if (newVersion) {
    argParts.push("-NewVersion", newVersion);
  }
  const psArgs = argParts.map((a) => psSingleQuote(a)).join(",");
  const elevateCmd =
    `Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden ` +
    `-ArgumentList @(${psArgs})`;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", elevateCmd],
    { detached: true, stdio: "ignore", windowsHide: true },
  );
  child.unref();
  return child.pid || null;
}

/**
 * Permission chain for Client OTA Apply (mirrors Agent).
 * - Elevated → direct update-client.ps1 → ok (mode direct)
 * - Non-elevated → schtasks SYSTEM; else UAC RunAs → elevationRequired
 * Never report plain success for non-elevated path.
 */
function launchElevatedClientUpdateApply(options) {
  const elevated = options.elevated ?? isProcessElevated();
  const programDataRoot = options.programDataRoot ?? resolveProgramDataClientRoot();
  const tryTask = options.tryScheduledTask ?? tryStartUpdateScheduledTask;
  const startDirect = options.startDirect ?? startUpdateDirect;
  const startUac = options.startUac ?? startUpdateViaUacRunAs;
  const oldVersion = options.oldVersion || "";
  const newVersion = options.newVersion || "";

  if (!fs.existsSync(options.scriptPath)) {
    return { ok: false, error: "未找到 update-client.ps1" };
  }
  if (!fs.existsSync(options.setupPath)) {
    return { ok: false, error: "未找到 Setup.exe（请先下载）" };
  }

  writeApplyRequest(
    {
      setupPath: options.setupPath,
      source: options.setupPath,
      script: options.scriptPath,
      oldVersion,
      newVersion,
      requestedAt: new Date().toISOString(),
    },
    programDataRoot,
  );

  writeInstallerStartEvent(
    {
      event: "CLIENT_APPLY_LAUNCH",
      timestamp: new Date().toISOString(),
      oldVersion,
      newVersion,
      installerPath: options.setupPath,
      scriptPath: options.scriptPath,
      elevated,
    },
    programDataRoot,
  );

  if (elevated) {
    const pid = startDirect(options.scriptPath, options.setupPath, oldVersion, newVersion);
    writeInstallerStartEvent(
      {
        event: "CLIENT_APPLY_MODE",
        mode: "direct",
        pid,
        timestamp: new Date().toISOString(),
      },
      programDataRoot,
    );
    return { ok: true, mode: "direct", pid };
  }

  if (tryTask()) {
    writeInstallerStartEvent(
      {
        event: "CLIENT_APPLY_MODE",
        mode: "scheduled-task",
        taskName: CLIENT_UPDATE_TASK_NAME,
        timestamp: new Date().toISOString(),
      },
      programDataRoot,
    );
    return {
      ok: true,
      mode: "scheduled-task",
      elevationRequired: true,
      taskName: CLIENT_UPDATE_TASK_NAME,
    };
  }

  try {
    const pid = startUac(options.scriptPath, options.setupPath, oldVersion, newVersion);
    writeInstallerStartEvent(
      {
        event: "CLIENT_APPLY_MODE",
        mode: "uac-runas",
        pid,
        timestamp: new Date().toISOString(),
      },
      programDataRoot,
    );
    return { ok: true, mode: "uac-runas", elevationRequired: true, pid };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `无法启动提权更新: ${message}` };
  }
}

module.exports = {
  CLIENT_UPDATE_TASK_NAME,
  ELEVATION_REQUIRED,
  isProcessElevated,
  resolveProgramDataClientRoot,
  resolveApplyRequestPath,
  writeApplyRequest,
  writeInstallerStartEvent,
  tryStartUpdateScheduledTask,
  startUpdateDirect,
  startUpdateViaUacRunAs,
  launchElevatedClientUpdateApply,
};
