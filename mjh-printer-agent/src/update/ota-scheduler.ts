import { logger } from "../logger.js";
import { loadOtaConfig, isOtaRemoteEnabled } from "./ota-config.js";
import { runOtaBackgroundTick } from "./ota-service.js";

let timer: NodeJS.Timeout | null = null;
let stopped = false;

/**
 * Periodic remote check + background download. Does not apply updates.
 */
export function startOtaScheduler(): void {
  stopOtaScheduler();
  stopped = false;
  const config = loadOtaConfig();
  if (!isOtaRemoteEnabled(config)) {
    logger.info("OTA scheduler idle (remote update disabled)", "OTA");
    return;
  }

  const intervalMs = Math.max(5, config.checkIntervalMinutes) * 60_000;
  logger.info(
    `OTA scheduler started intervalMinutes=${config.checkIntervalMinutes}`,
    "OTA",
  );

  // First tick after a short delay so startup / printing is not blocked.
  const initial = setTimeout(() => {
    if (stopped) return;
    void runOtaBackgroundTick();
  }, 60_000);

  timer = setInterval(() => {
    if (stopped) return;
    void runOtaBackgroundTick();
  }, intervalMs);

  // Keep refs for clear on stop
  (timer as NodeJS.Timeout & { __initial?: NodeJS.Timeout }).__initial = initial;
}

export function stopOtaScheduler(): void {
  stopped = true;
  if (timer) {
    const initial = (timer as NodeJS.Timeout & { __initial?: NodeJS.Timeout }).__initial;
    if (initial) clearTimeout(initial);
    clearInterval(timer);
    timer = null;
  }
}
