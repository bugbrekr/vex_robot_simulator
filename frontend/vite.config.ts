import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

// Build id baked into the bundle and written to dist/build.json; the server reports the id of
// the files it serves, so a tab running an older build can tell the user to reload.
const BUILD_ID = Date.now().toString(36);
const buildInfo: Plugin = {
  name: "vexsim-build-info",
  apply: "build",
  writeBundle(opts) {
    writeFileSync(resolve(opts.dir ?? "dist", "build.json"), JSON.stringify({ build: BUILD_ID }));
  },
};

// The app is served by FastAPI under /vex_cte/ (VEXSIM_BASE_PATH) and may sit behind any
// reverse-proxy prefix, so every asset / API / WebSocket URL is relative ("./").
// Dev: open http://localhost:5173/vex_cte/ (backend: `uv run vexsim serve`).
const BACKEND = "127.0.0.1:8000";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "./" : "/vex_cte/",
  define: { __BUILD_ID__: JSON.stringify(command === "build" ? BUILD_ID : "dev") },
  plugins: [buildInfo],
  build: { chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: {
      "^/vex_cte/api": `http://${BACKEND}`,
      "^/vex_cte/ws": { target: `ws://${BACKEND}`, ws: true },
    },
  },
}));
