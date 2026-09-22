/** Strip UTF-8 BOM so JSON.parse accepts PowerShell / Notepad UTF-8 files. */
export function stripBom(text: string): string {
  if (!text) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseJsonText(text: string): unknown {
  return JSON.parse(stripBom(text));
}
