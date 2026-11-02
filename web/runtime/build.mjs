// Builds the page runtime into pkg/server/assets/claude.js: one IIFE the
// server injects as the first script of every app page.
import { build } from "esbuild";
import { stamp } from "../build-stamp.mjs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: process.argv.includes("--minify"),
  outfile: "../../pkg/server/assets/claude.js",
  banner: { js: stamp("slop page runtime (window.claude), built from web/runtime") },
  logLevel: "info",
});
