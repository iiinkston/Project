import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
const require = createRequire(import.meta.url);
const lib = require("../../../../mjh-printer-client/electron/client-update-lib.cjs");
const url = "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe";
const sha = "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1";
const destDir = join(process.env.LOCALAPPDATA, "MJH Printer Client", "updates");
mkdirSync(destDir, { recursive: true });
const dest = join(destDir, "MJH Printer Setup.exe");
const nested = lib.parseClientManifest({
  client: { version: "1.0.6", url, sha256: sha },
});
console.log(JSON.stringify({ parsed: nested.clientVersion }));
const r = await lib.downloadVerifiedFile(url, dest, sha);
console.log(JSON.stringify({ ok: true, path: r.path, sha256: r.sha256 }));
