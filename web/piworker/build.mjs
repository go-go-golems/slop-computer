// Builds the Pi worker into dist/worker.js. The Pi packages stay external:
// node resolves them from this directory's node_modules at run time, so
// `slop serve --pi-worker web/piworker/dist/worker.js` needs `pnpm install`
// here (make piworker).
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "external",
  outfile: "dist/worker.js",
  logLevel: "info",
});
