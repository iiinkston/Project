/**
 * Real-network Agent OTA download+extract using v2.4.6 code against GitHub v1.0.6-test.
 * Does NOT apply to Program Files (no service replace).
 */
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  handleOtaUpdateCheck,
  handleOtaUpdateDownload,
  handleOtaUpdateStatus,
} from "../src/update/ota-service.js";

const clientSha =
  "503d0aad40758f957dea7bada485b46a4ae73fc81e5a5602b3263ad0427495a1";
const agentSha =
  "ee34c649f1a2427be25140d316cfda3283479526824b890edcd6320e91897c8d";

const dir = await mkdtemp(join(tmpdir(), "mjh-real-ota-"));
const prevPd = process.env.MJH_PROGRAMDATA_DIR;
const prevCfg = process.env.MJH_UPDATE_CONFIG_PATH;
process.env.MJH_PROGRAMDATA_DIR = dir;
await mkdir(join(dir, "config"), { recursive: true });
await mkdir(join(dir, "updates"), { recursive: true });

let port = 0;
const srv = createServer((req, res) => {
  if (req.url === "/manifest") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        client: {
          version: "1.0.6",
          url: "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Setup.exe",
          sha256: clientSha,
        },
        agent: {
          version: "2.4.6",
          url: "https://github.com/iiinkston/Project/releases/download/v1.0.6-test/MJH-Printer-Agent-v2.4.6.zip",
          sha256: agentSha,
        },
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const addr = srv.address();
if (!addr || typeof addr === "string") throw new Error("no port");
port = addr.port;

const cfg = join(dir, "config", "update.json");
process.env.MJH_UPDATE_CONFIG_PATH = cfg;
await writeFile(
  cfg,
  JSON.stringify({
    enabled: true,
    channel: "stable",
    manifestUrl: `http://127.0.0.1:${port}/manifest`,
    checkIntervalMinutes: 60,
  }),
);

try {
  const check = await handleOtaUpdateCheck();
  console.log(JSON.stringify({ phase: "check", check }));
  const dl = await handleOtaUpdateDownload();
  console.log(JSON.stringify({ phase: "download", dl }));
  const staged = join(dir, "updates", "MJH-Printer-Agent.exe");
  console.log(
    JSON.stringify({
      phase: "staged",
      exists: existsSync(staged),
      bytes: existsSync(staged) ? (await readFile(staged)).length : 0,
    }),
  );
  const st = handleOtaUpdateStatus();
  console.log(
    JSON.stringify({
      phase: "status",
      ready: st.ready,
      downloaded: st.downloaded,
      latest: st.latestVersion,
    }),
  );
} finally {
  srv.close();
  if (prevPd === undefined) delete process.env.MJH_PROGRAMDATA_DIR;
  else process.env.MJH_PROGRAMDATA_DIR = prevPd;
  if (prevCfg === undefined) delete process.env.MJH_UPDATE_CONFIG_PATH;
  else process.env.MJH_UPDATE_CONFIG_PATH = prevCfg;
  await rm(dir, { recursive: true, force: true });
}
