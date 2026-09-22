"use strict";

/**
 * Pure helpers for Client main-process stability (testable without Electron).
 */

function formatAppStartLog({ version, execPath, hardwareAcceleration, singleInstance }) {
  return [
    `app start version=${version}`,
    `exec=${execPath}`,
    `hwAccel=${hardwareAcceleration ? "on" : "off"}`,
    `singleInstance=${singleInstance ? "yes" : "no"}`,
  ].join(" ");
}

function formatRendererCrashLog({ reason, exitCode, recoveryCount, version }) {
  return [
    `renderer crash reason=${reason}`,
    `exit=${exitCode}`,
    `recoveryCount=${recoveryCount}`,
    `version=${version}`,
  ].join(" ");
}

function formatRendererRecoveryLog({ recoveryCount, version }) {
  return `renderer recovery reload recoveryCount=${recoveryCount} version=${version}`;
}

function formatSecondInstanceLog({ version }) {
  return `second-instance focus existing version=${version}`;
}

/**
 * Decide whether to schedule a renderer reload after render-process-gone.
 * @returns {{ shouldReload: boolean, recoveryCount: number }}
 */
function planRendererRecovery(state, { isQuitting, windowAlive }) {
  const recoveryCount = (state.recoveryCount || 0) + 1;
  if (isQuitting || !windowAlive) {
    return { shouldReload: false, recoveryCount };
  }
  return {
    shouldReload: true,
    recoveryCount,
    lastRecoveryAt: Date.now(),
  };
}

module.exports = {
  formatAppStartLog,
  formatRendererCrashLog,
  formatRendererRecoveryLog,
  formatSecondInstanceLog,
  planRendererRecovery,
};
