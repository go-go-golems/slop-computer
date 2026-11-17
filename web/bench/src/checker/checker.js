// checker/checker.js — the type checker: TypeScript's own, in a worker of
// its own (SLOP3-024 phase 3, design §6.2), built into checker.js.
//
// It checks an app the way `slop types` sets it up for tsc: two programs,
// the pages (ES2022 and the DOM, page.d.ts and actions.d.ts) and the actor
// (ES2020, no DOM, actor.d.ts and modules.d.ts, the entry and server/),
// with the options client.Tsconfigs writes (pkg/client/types.go), the JSX
// options of the app's tsconfig.json and the vendored packages' paths
// (vendor/tsconfig.vendor.json). Each program is a language service kept
// warm: a check after an edit re-checks what changed (tens of ms; the first
// check parses the DOM's types, about a second).
//
// It runs apart from the QuickJS sandbox, which the page restarts when an
// eval overruns; a restart must not throw the warm checker away.
//
// Messages (each answered with {id, ok, …} or {id, ok: false, error}):
//   {type: 'check', id, files: {path: text}, decl: {name: text}}
//     → {diags: [{file, line, col, code, message, program}], ms}
//     files: the app's TypeScript and config files; decl: app.types's files
//   {type: 'info', id, files, decl, path, pos} → {text, doc} (the type at pos)
//   {type: 'transpile', id, code} → {code} (an eval's body, types stripped)
import ts from 'typescript';

/* global __TS_LIBS__ */
const LIBS = __TS_LIBS__ // {lib.es2022.d.ts: text, …}
const ROOT = '/app/', TYPES = ROOT + '.slop/types/', LIBDIR = '/lib/'

let files = new Map() // absolute path → {v, text}
let version = 0
function setFiles(input, decl) {
  const next = new Map()
  const put = (abs, text) => {
    const cur = files.get(abs)
    next.set(abs, cur && cur.text === text ? cur : { v: ++version, text })
  }
  for (const [p, text] of Object.entries(input || {})) if (typeof text === 'string') put(ROOT + p, text)
  for (const [n, text] of Object.entries(decl || {})) if (typeof text === 'string') put(TYPES + n, text)
  files = next
}
const libText = f => (f.startsWith(LIBDIR) ? LIBS[f.slice(LIBDIR.length)] : undefined)
const rel = abs => abs.slice(ROOT.length)
const json = abs => {
  const f = files.get(abs)
  if (!f) return null
  const r = ts.parseConfigFileTextToJson(abs, f.text) // allows comments, like tsc
  return r.error ? null : r.config
}
const isCode = p => /\.(ts|tsx|mts|cts)$/.test(p) && !p.endsWith('.d.ts')

// The app's two programs: their root files and options.
function plan() {
  const app = json(ROOT + 'app.json') || {}
  const actor = typeof app.actor === 'string' ? app.actor : ''
  const own = (json(ROOT + 'tsconfig.json') || {}).compilerOptions || {}
  const vendor = (json(ROOT + 'vendor/tsconfig.vendor.json') || {}).compilerOptions || {}
  const base = {
    module: 'ESNext', moduleResolution: 'Bundler', moduleDetection: 'force', strict: true, isolatedModules: true,
    allowImportingTsExtensions: true, noEmit: true, skipLibCheck: true, types: [],
  }
  for (const k of ['jsx', 'jsxImportSource', 'jsxFactory', 'jsxFragmentFactory']) if (own[k] !== undefined) base[k] = own[k]
  if (vendor.paths) { base.paths = vendor.paths; base.baseUrl = vendor.baseUrl || '.' }
  const opts = raw => {
    const r = ts.convertCompilerOptionsFromJson(raw, ROOT)
    if (r.options.baseUrl) r.options.baseUrl = ROOT + (vendor.baseUrl || '.').replace(/^\.\/?/, '')
    return r.options
  }
  const all = [...files.keys()].map(rel)
  const skip = p => p.startsWith('server/') || p.startsWith('vendor/') || p.startsWith('node_modules/') || p.startsWith('.slop/')
  const pages = {
    name: 'pages',
    roots: [TYPES + 'page.d.ts', TYPES + 'actions.d.ts', ...all.filter(p => isCode(p) && p !== actor && !skip(p)).map(p => ROOT + p)].filter(f => files.has(f)),
    options: opts({ ...base, target: 'ES2022', lib: ['ES2022', 'DOM', 'DOM.Iterable'] }),
  }
  const out = [pages]
  if (actor && isCode(actor)) {
    out.push({
      name: 'actor',
      roots: [TYPES + 'actor.d.ts', TYPES + 'modules.d.ts', ROOT + actor, ...all.filter(p => isCode(p) && p.startsWith('server/')).map(p => ROOT + p)].filter(f => files.has(f)),
      options: opts({ ...base, target: 'ES2020', lib: ['ES2020'] }),
    })
  }
  return out
}

const registry = ts.createDocumentRegistry()
const services = new Map() // program name → {service, current: {roots, options}}
function serviceFor(p) {
  let s = services.get(p.name)
  if (!s) {
    const cur = { roots: p.roots, options: p.options }
    const host = {
      getScriptFileNames: () => cur.roots,
      getScriptVersion: f => String(files.has(f) ? files.get(f).v : 0),
      getScriptSnapshot: f => {
        const t = files.has(f) ? files.get(f).text : libText(f)
        return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t)
      },
      getCurrentDirectory: () => ROOT,
      getCompilationSettings: () => cur.options,
      getDefaultLibFileName: o => LIBDIR + ts.getDefaultLibFileName(o),
      fileExists: f => files.has(f) || libText(f) !== undefined,
      readFile: f => (files.has(f) ? files.get(f).text : libText(f)),
      directoryExists: d => {
        const dir = d.endsWith('/') ? d : d + '/'
        if (dir === LIBDIR || ROOT.startsWith(dir)) return true
        for (const k of files.keys()) if (k.startsWith(dir)) return true
        return false
      },
      getDirectories: () => [],
      useCaseSensitiveFileNames: () => true,
    }
    s = { service: ts.createLanguageService(host, registry), cur }
    services.set(p.name, s)
  }
  s.cur.roots = p.roots; s.cur.options = p.options
  return s.service
}

const MAX_DIAGS = 200
function check() {
  const out = []
  for (const p of plan()) {
    const ls = serviceFor(p)
    for (const f of p.roots) {
      if (f.startsWith(TYPES)) continue
      for (const d of [...ls.getSyntacticDiagnostics(f), ...ls.getSemanticDiagnostics(f)]) {
        if (out.length >= MAX_DIAGS) return out
        const file = d.file ? d.file.fileName : f
        if (!file.startsWith(ROOT) || file.startsWith(TYPES)) continue
        const lc = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 }
        out.push({ file: rel(file), line: lc.line + 1, col: lc.character + 1, code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 600), program: p.name })
      }
    }
  }
  return out
}

function info(path, pos) {
  const abs = ROOT + path
  const p = plan().find(x => x.roots.includes(abs))
  if (!p) return null
  const q = serviceFor(p).getQuickInfoAtPosition(abs, pos)
  if (!q) return null
  return { text: ts.displayPartsToString(q.displayParts), doc: ts.displayPartsToString(q.documentation || []) }
}

// An eval's body: statements with top-level await and return. It is wrapped
// in an async function to strip its types, then unwrapped. Lines mostly keep
// their numbers; a declaration that is only a type (an interface) drops out.
const HEAD = 'async function __slop_eval__() {\n'
function transpile(code) {
  const r = ts.transpileModule(HEAD + code + '\n}', {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: false, verbatimModuleSyntax: false },
    reportDiagnostics: true, fileName: 'eval.ts',
  })
  const bad = (r.diagnostics || []).find(d => d.category === ts.DiagnosticCategory.Error)
  if (bad) {
    const line = bad.file && bad.start !== undefined ? bad.file.getLineAndCharacterOfPosition(bad.start).line : 0
    throw Object.assign(new Error(ts.flattenDiagnosticMessageText(bad.messageText, '\n')), { line })
  }
  const text = r.outputText
  const start = text.indexOf('{\n') + 2, end = text.lastIndexOf('}')
  if (!text.startsWith('async function __slop_eval__()') || start < 2 || end < start) throw new Error('could not unwrap the transpiled eval')
  return text.slice(start, end).replace(/\n$/, '')
}

self.onmessage = e => {
  const m = e.data || {}
  const t0 = performance.now()
  try {
    let out
    if (m.type === 'check') { setFiles(m.files, m.decl); out = { diags: check() } }
    else if (m.type === 'info') { setFiles(m.files, m.decl); out = info(m.path, m.pos) || {} }
    else if (m.type === 'transpile') out = { code: transpile(String(m.code || '')) }
    else throw new Error('unknown message ' + m.type)
    self.postMessage({ id: m.id, ok: true, ms: Math.round(performance.now() - t0), ...out })
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err), line: err && err.line })
  }
}
self.postMessage({ type: 'ready', version: ts.version })
