declare const __MJH_VERSION__: string | undefined;
declare const __MJH_BUILD__: string | undefined;

export const AGENT_VERSION: string =
  typeof __MJH_VERSION__ !== "undefined" ? __MJH_VERSION__ : "2.4.0";

export const AGENT_BUILD: string =
  typeof __MJH_BUILD__ !== "undefined" ? __MJH_BUILD__ : "dev";
