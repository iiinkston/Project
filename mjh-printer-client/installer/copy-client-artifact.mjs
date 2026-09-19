import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const unpacked = join(root, "dist", "client-build", "win-unpacked", "MJH Printer Client.exe");
const destDir = join(root, "dist");
const dest = join(destDir, "MJH Printer Client.exe");

if (!existsSync(unpacked)) {
  console.error(`[copy-client] missing ${unpacked} — run pnpm dist:win first`);
  process.exit(1);
}
mkdirSync(destDir, { recursive: true });
copyFileSync(unpacked, dest);
console.log(`[copy-client] ${dest}`);
