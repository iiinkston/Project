/// <reference types="vite/client" />

export {};

declare global {
  const __MJH_CLIENT_VERSION__: string;

  interface Window {
    mjhDesktop?: {
      platform: string;
      getVersion?: () => Promise<string>;
      onNavigate?: (callback: (tab: string) => void) => (() => void) | void;
    };
  }
}
