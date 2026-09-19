import { cpSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const project = join(root, "..");
const src = join(project, "mjh-printer-agent", "release");
const dest = join(root, "installer", "agent-release");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
for (const name of readdirSync(dest)) {
  if (name.endsWith(".zip")) {
    rmSync(join(dest, name), { force: true });
  }
}
console.log(`[stage-agent] copied release → ${dest}`);
