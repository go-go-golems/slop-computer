// How long the TypeScript checker takes on a small slop app, cold and warm,
// and how much memory it holds: the numbers behind notes section 8 (type
// checking in the bench runs in a browser worker).
//
//   node 01-ts-check-latency.cjs <path to node_modules/typescript>
//
// web/runtime already depends on typescript; after `pnpm install` there, pass
// web/runtime/node_modules/typescript. The browser runs the same V8, so the
// timings carry over to a Web Worker.
//
// On 2026-11-16 (TypeScript 5.9.3, this machine):
//   cold check: 1255 ms, 0 errors              (mostly parsing lib.dom.d.ts)
//   re-check after an edit: 88 ms, 1 error: Property 'txt' does not exist on
//     type '{ text: string; by: string; }'. Did you mean 'text'?
//   re-check after another edit: 32 ms
//   heap used: 79 MB
// Sizes: lib/typescript.js 9,112,572 bytes (1,633,773 gzipped); the es2022 +
// dom lib .d.ts files 2,413,666 bytes (318,455 gzipped).
const ts = require(process.argv[2])
const files = new Map([
  ['/app/slop.d.ts', { v: 1, text: 'declare const claude: { use(n: "slop"): Promise<{ actions: { list(a: {}): Promise<{ text: string, by: string }[]>, add(a: { text: string }): Promise<void> } }> }' }],
  ['/app/main.ts', { v: 1, text: 'const slop = await claude.use("slop")\nconst list = document.getElementById("list")!\nexport async function show() {\n  const rows = await slop.actions.list({})\n  list.replaceChildren(...rows.map(r => Object.assign(document.createElement("li"), { textContent: r.text + " · " + r.by })))\n}\n' }],
  ['/app/util.ts', { v: 1, text: 'export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-")\n' }],
])
const opts = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], strict: true, noEmit: true, isolatedModules: true }
const host = {
  getScriptFileNames: () => [...files.keys()], getScriptVersion: f => String((files.get(f) || {}).v || 0),
  getScriptSnapshot: f => files.has(f) ? ts.ScriptSnapshot.fromString(files.get(f).text) : ts.sys.fileExists(f) ? ts.ScriptSnapshot.fromString(ts.sys.readFile(f)) : undefined,
  getCurrentDirectory: () => '/app', getCompilationSettings: () => opts, getDefaultLibFileName: o => ts.getDefaultLibFilePath(o),
  fileExists: f => files.has(f) || ts.sys.fileExists(f), readFile: f => files.has(f) ? files.get(f).text : ts.sys.readFile(f),
}
const diag = ls => [...files.keys()].flatMap(f => ls.getSemanticDiagnostics(f).concat(ls.getSyntacticDiagnostics(f)))
let t = performance.now(); const ls = ts.createLanguageService(host, ts.createDocumentRegistry()); let d = diag(ls)
console.log('cold check:', Math.round(performance.now() - t), 'ms,', d.length, 'errors')
// an eval writes a bug: r.txt instead of r.text
files.set('/app/main.ts', { v: 2, text: files.get('/app/main.ts').text.replace('r.text +', 'r.txt +') })
t = performance.now(); d = diag(ls)
console.log('re-check after an edit:', Math.round(performance.now() - t), 'ms,', d.length, 'error:', d.map(x => ts.flattenDiagnosticMessageText(x.messageText, ' ')).join(' | '))
files.set('/app/util.ts', { v: 2, text: 'export const slug = (s: string) => s.toLowerCase()\n' })
t = performance.now(); d = diag(ls)
console.log('re-check after another edit:', Math.round(performance.now() - t), 'ms')
console.log('heap used:', Math.round(process.memoryUsage().heapUsed / 1e6), 'MB')
