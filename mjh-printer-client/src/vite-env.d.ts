/// <reference types="vite/client" />

export {};

declare global {
  const __MJH_CLIENT_VERSION__: string;

  type ClientUpdateCheckResult = {
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    notes: string | null;
    remoteEnabled: boolean;
    ready: boolean;
    lastError: string | null;
  };

  type ClientUpdateActionResult = {
    ok: boolean;
    ready?: boolean;
    path?: string;
    latestVersion?: string;
    message?: string;
    error?: string;
    code?: string;
    elevationStarted?: boolean;
    quitting?: boolean;
    mode?: string;
    taskName?: string;
    pid?: number | null;
  };

  interface Window {
    mjhDesktop?: {
      platform: string;
      getVersion?: () => Promise<string>;
      log?: (message: string) => Promise<void>;
      clientUpdateCheck?: () => Promise<ClientUpdateCheckResult>;
      clientUpdateDownload?: () => Promise<ClientUpdateActionResult>;
      clientUpdateApply?: () => Promise<ClientUpdateActionResult>;
      onNavigate?: (callback: (tab: string) => void) => (() => void) | void;
    };
  }
}
