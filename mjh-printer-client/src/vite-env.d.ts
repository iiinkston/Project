/// <reference types="vite/client" />

export {};

declare global {
  const __MJH_CLIENT_VERSION__: string;

  interface Window {
    mjhDesktop?: {
      platform: string;
      getVersion?: () => Promise<string>;
      log?: (message: string) => Promise<void>;
      onNavigate?: (callback: (tab: string) => void) => (() => void) | void;
    };
  }
}
