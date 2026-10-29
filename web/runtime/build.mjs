// Builds the page runtime into pkg/render/assets/claude.js: one IIFE the
// server injects as the first script of every app page.
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: process.argv.includes("--minify"),
  outfile: "../../pkg/render/assets/claude.js",
  banner: { js: "/* slop page runtime (window.claude), built from web/runtime: do not edit */" },
  logLevel: "info",
});
