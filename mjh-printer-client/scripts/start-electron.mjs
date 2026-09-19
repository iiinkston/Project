import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.dirname(fileURLToPath(import.meta.url));
const project = path.join(root, "..");
const require = createRequire(import.meta.url);
const electronPath = require("electron");

const child = spawn(electronPath, ["."], {
  cwd: project,
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_DEV_SERVER_URL: process.env.VITE_DEV_SERVER_URL || "http://127.0.0.1:5173",
  },
});

child.on("exit", (code) => process.exit(code ?? 0));
