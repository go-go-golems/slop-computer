// Builds the page runtime into pkg/doors/pages/assets/claude.js: one IIFE the
// server injects as the first script of every app page. Also writes
// pkg/apptypes/page.d.ts: window.claude's type, the declarations of
// src/types.ts and what it imports (SLOP3-024), which app.types returns.
import { writeFileSync } from "node:fs";
import { build } from "esbuild";
import ts from "typescript";
import { stamp } from "../build-stamp.mjs";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: process.argv.includes("--minify"),
  outfile: "../../pkg/doors/pages/assets/claude.js",
  banner: { js: stamp("slop page runtime (window.claude), built from web/runtime") },
  logLevel: "info",
});

// One file of ambient modules (AMD outFile emits them so), renamed under
// slop:page/ so they cannot meet an app's own package names, and the global.
const program = ts.createProgram(["src/types.ts"], {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  module: ts.ModuleKind.AMD,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  strict: true,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  declaration: true,
  emitDeclarationOnly: true,
  outFile: "page.d.ts",
  rootDir: "src",
  types: [],
});
const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error);
if (errors.length) {
  console.error(ts.formatDiagnostics(errors, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => process.cwd(), getNewLine: () => "\n" }));
  process.exit(1);
}
let dts = "";
program.emit(undefined, (_name, text) => { dts = text; }, undefined, true);
const names = new Set([...dts.matchAll(/^declare module "([^"]+)"/gm)].map((m) => m[1]));
dts = dts.replace(/(declare module |from |import\()"([^"]+)"/g, (all, pre, name) => (names.has(name) ? `${pre}"slop:page/${name}"` : all));
writeFileSync("../../pkg/apptypes/page.d.ts", [
  stamp("slop page runtime declarations (window.claude), built from web/runtime"),
  "// window.claude: claude.use(name) resolves a capability's namespace, or null.",
  "// claude.use<Actions>(\"slop\") types the actor's actions by the app's contract.",
  dts.trimEnd(),
  "",
  "declare const claude: import(\"slop:page/types\").Claude;",
  "interface Window { readonly claude: import(\"slop:page/types\").Claude }",
  "/** A value as it arrives after crossing the wire as JSON. */",
  "type JsonOf<T> = import(\"slop:page/types\").JsonOf<T>;",
  "",
].join("\n"));
