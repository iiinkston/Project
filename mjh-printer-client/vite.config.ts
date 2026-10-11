import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

/**
 * Electron loads index.html via file:// (inside app.asar).
 * Vite defaults can break that in two ways:
 *  1) base "/" → href="/assets/...") resolves to file:///assets/... (ERR_FILE_NOT_FOUND)
 *  2) crossorigin on <script>/<link> → CORS mode under file:// fails the same assets
 */
function electronFileProtocolHtml(): Plugin {
  return {
    name: "mjh-electron-file-protocol-html",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        // Only rewrite built asset tags — never touch the Vite dev entry (/src/main.tsx).
        return html
          .replace(/\s+crossorigin(?:="[^"]*")?/gi, "")
          .replace(/(href|src)=["']\/assets\//gi, '$1="./assets/');
      },
    },
  };
}

export default defineConfig({
  // Required for Electron file:// — absolute /assets/* breaks production UI (white screen).
  base: "./",
  plugins: [react(), electronFileProtocolHtml()],
  define: {
    __MJH_CLIENT_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    // Keep modulepreload off — avoids extra absolute/crossorigin link tags under file://.
    modulePreload: false,
  },
});
