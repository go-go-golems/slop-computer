// Sandbox worker for the eval tool.
// Engine 1 (preferred): QuickJS compiled to wasm. A session (one per agent thread, one for the Eval panel) keeps its
// QuickJS context between evals, so top-level declarations persist; the page restores them from JSON after a reload.
// Each eval gets an interrupt deadline; the context has a memory limit; the page's API is reachable only through
// one bridge function that returns promises.
// Engine 2 (fallback): this worker's own JS realm, scope kept in a plain object. A capability boundary, not a sandbox.
import { getQuickJS, shouldInterruptAfterDeadline } from '@tootallnate/quickjs-emscripten'
import * as acorn from 'acorn'
import { rewrite } from './rewrite.js'
/* global __CORE_SRC__ */
const CORE = __CORE_SRC__          // src/core.js, inlined by the build

let QJS = null
let engine = 'loading'
let CLEAN_GLOBALS = new Set()
const ready = getQuickJS()
  .then(q => {
    QJS = q; engine = 'quickjs'
    const vm = q.newContext(); const r = vm.evalCode('Object.getOwnPropertyNames(globalThis)')
    if (!r.error) { CLEAN_GLOBALS = new Set(vm.dump(r.value)); r.value.dispose() } else r.error.dispose()
    vm.dispose()
  })
  .catch(err => { engine = 'worker'; CLEAN_GLOBALS = new Set(Object.getOwnPropertyNames(self)); self.postMessage({ type: 'engine', engine, error: String(err && err.message || err) }) })
  .then(() => self.postMessage({ type: 'engine', engine }))

let seq = 0
const pending = new Map()
function hostCall(eid, name, args) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    self.postMessage({ type: 'call', id, eid, name, args })
  })
}

self.onmessage = async e => {
  const m = e.data || {}
  if (m.type === 'reply') {
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.ok) p.resolve(m.value)
    else { const er = new Error(m.error && m.error.message || 'host error'); er.kind = m.error && m.error.kind || 'host'; p.reject(er) }
    return
  }
  if (m.type === 'drop') { dropSession(m.sid); return }
  if (m.type === 'eval') {
    await ready
    const want = m.engine === 'worker' ? 'worker' : engine
    const t0 = Date.now()
    let out
    try { out = want === 'quickjs' ? await runQuick(m) : await runPlain(m) }
    catch (err) { out = { ok: false, error: { kind: 'internal', message: String(err && err.message || err) }, logs: [] } }
    out.engine = want
    out.ms = Date.now() - t0
    if (!out.ok && out.error) out.error = explain(out.error, m, out.known || [])
    delete out.known
    self.postMessage({ type: 'result', id: m.id, ...out })
  }
}

// ---------- names: the API's own, plus the prelude's ----------
function apiShape(api) {
  const ns = {}, flat = []
  for (const name of api) { const [a, b] = name.split('.'); if (b) (ns[a] = ns[a] || []).push(b); else flat.push(a) }
  return { ns, flat }
}
const CORE_NAMES = ['step', 'id', 'seq', 'par', 'alt', 'loop', 'dyn', 'llm', 'delegate', 's', 'monoid', 'help', 'tx', 'setTimeout', 'clearTimeout']
const PRELUDE_NAMES = ['__call', '__API', '__SIGS', '__ROLES', '__PASS', '__lev', '__near', '__ns', '__names', '__lib', '__declare', '__keep', '__kind', 'vars', 'forget', 'lib', '__fmt', 'console', 'sleep', '__snapshot', '__restore', '__libSet', '__libLoad', '__host', '__log', '__eid', 'globalThis', 'undefined', 'NaN', 'Infinity', 'eval', 'arguments', ...CORE_NAMES]
function reservedFor(api) { const { ns, flat } = apiShape(api); return new Set([...Object.keys(ns), ...flat, ...PRELUDE_NAMES, ...(CORE.match(/^(?:function|const|class) (__\w+)/gm) || []).map(x => x.split(' ')[1])]) }

// ---------- the prelude, evaluated once per session ----------
// verbs that stay direct calls returning promises; every other module verb returns a Step
const DIRECT = new Set(['lib.def', 'lib.list', 'lib.remove', 'lib.source', 'log', 'sleep', 'tx.begin', 'tx.commit', 'tx.rollback', 'dry.begin', 'dry.end', 'dry.apply', 'dry.discard', 'agents.delegate', 'agents.roles', 'llm', 'ui.approve'])
function preludeSource(api, sigs = {}, roles = []) {
  const { ns, flat } = apiShape(api)
  let src = 'const __call = async (n, a) => { try { return JSON.parse(await __host(n, JSON.stringify(a === undefined ? [] : a))) } catch (e) { if (e && typeof e === "object" && !e.kind) e.kind = e.name; throw e } };\n'
  src += 'const __API = ' + JSON.stringify(api.filter(n => !DIRECT.has(n) || n.startsWith('lib.'))) + ';\n'
  src += 'const __SIGS = ' + JSON.stringify(Object.fromEntries(Object.entries(sigs).filter(([k]) => !DIRECT.has(k)))) + ';\n'
  src += 'const __ROLES = ' + JSON.stringify(roles) + ';\n'
  src += 'const __lev = (a, b) => { const m = []; for (let i = 0; i <= b.length; i++) m[i] = [i]; for (let j = 0; j <= a.length; j++) m[0][j] = j; for (let i = 1; i <= b.length; i++) for (let j = 1; j <= a.length; j++) m[i][j] = Math.min(m[i-1][j] + 1, m[i][j-1] + 1, m[i-1][j-1] + (b[i-1] === a[j-1] ? 0 : 1)); return m[b.length][a.length] };\n'
  src += 'const __near = (k, names) => { let best = null, bd = Math.max(2, Math.floor(k.length / 3)) + 1; for (const n of names) { const d = __lev(k.toLowerCase(), n.toLowerCase()); if (d < bd) { bd = d; best = n } } return best };\n'
  // namespaces answer an unknown verb with the nearest real one, in this namespace or another
  src += 'const __PASS = ["then", "toJSON", "constructor", "valueOf", "toString", "inspect", "prototype", "length", "name", "$$typeof", "asymmetricMatch", "__step", "__loop", "verb", "nodeType"];\n'
  src += 'const __ns = (name, obj) => new Proxy(Object.freeze(Object.assign(obj, { __ns: name })), { get(t, k) { if (typeof k !== "string" || k in t || __PASS.includes(k)) return t[k];' +
    ' const own = __near(k, Object.keys(t)), other = __near(k, __API.filter(n => n.includes(".")).map(n => n.split(".")[1]));' +
    ' const elsewhere = !own && other ? __API.find(n => n.endsWith("." + other)) : null;' +
    ' throw new TypeError(name + "." + k + " is not part of the API." + (own ? " Did you mean " + name + "." + own + "?" : elsewhere ? " Did you mean " + elsewhere + "?" : "") + " " + name + " has: " + Object.keys(t).filter(x => x !== "__ns").join(", ")) } });\n'
  for (const a of Object.keys(ns)) {
    if (a === 'lib') continue
    const verbs = ns[a].filter(b => !DIRECT.has(a + '.' + b))
    if (!verbs.length) continue
    src += `const ${a} = __ns(${JSON.stringify(a)}, { ${verbs.map(b => `${b}: Object.assign((...args) => __tool(${JSON.stringify(a + '.' + b)}, args), { verb: ${JSON.stringify(a + '.' + b)} })`).join(', ')} });\n`
  }
  for (const f of flat) if (f !== 'llm' && f !== 'sleep') src += `const ${f} = (...args) => __call(${JSON.stringify(f)}, args);\n`
  // persistent scope
  src += 'const __names = new Set(); const __lib = {};\n'
  src += 'const __declare = (...n) => { for (const x of n) __names.add(x) };\n'
  src += 'const __keep = (n, v) => { globalThis[n] = v; __names.add(n) };\n'
  src += 'const __kind = v => v === null ? "null" : Array.isArray(v) ? "array(" + v.length + ")" : typeof v === "string" ? "string(" + v.length + ")" : typeof v === "object" ? "object{" + Object.keys(v).slice(0, 6).join(",") + (Object.keys(v).length > 6 ? ",…" : "") + "}" : typeof v === "function" ? "function" : typeof v + " " + String(v).slice(0, 30);\n'
  src += 'const vars = () => { const o = {}; for (const n of __names) if (n in globalThis) o[n] = __kind(globalThis[n]); return o };\n'
  src += 'const forget = (...n) => { const all = n.length ? n : [...__names]; for (const x of all) { if (__names.has(x)) { delete globalThis[x]; __names.delete(x) } } return all.length };\n'
  src += 'const lib = new Proxy(__lib, { get(t, k) {' +
    ' if (k === "def") return (name, fn, opts) => { if (typeof name !== "string") throw new TypeError("lib.def(name, fn, {description}): name must be a string"); if (typeof fn !== "function") throw new TypeError("lib.def(name, fn, {description}): fn must be a function"); return __call("lib.def", [name, fn.toString(), typeof opts === "string" ? { description: opts } : (opts || {})]) };' +
    ' if (k === "list") return () => __call("lib.list", []);' +
    ' if (k === "remove") return name => __call("lib.remove", [name]);' +
    ' if (k === "source") return name => __call("lib.source", [name]);' +
    ' if (typeof k !== "string" || k in t || __PASS.includes(k)) return t[k];' +
    ' const near = __near(k, Object.keys(t));' +
    ' throw new TypeError("lib." + k + " is not saved." + (near ? " Did you mean lib." + near + "?" : "") + " Saved: " + (Object.keys(t).join(", ") || "none") + ". Save one with lib.def(name, fn, {description}).") } });\n'
  src += 'const __fmt = v => { if (typeof v === "string") return v; try { return JSON.stringify(v); } catch (e) { return String(v); } };\n'
  src += 'const console = { log: (...a) => __log("log", a.map(__fmt).join(" ")), info: (...a) => __log("log", a.map(__fmt).join(" ")), warn: (...a) => __log("warn", a.map(__fmt).join(" ")), error: (...a) => __log("error", a.map(__fmt).join(" ")) };\n'
  src += 'const sleep = ms => __call("sleep", [ms]);\n'
  src += 'const __snapshot = () => { const out = {}, skipped = []; for (const n of __names) { if (!(n in globalThis)) continue; const v = globalThis[n];' +
    ' if (typeof v === "function") { skipped.push(n + " (a function: save it with lib.def to keep it)"); continue }' +
    ' try { const s = JSON.stringify(v); if (s === undefined) { skipped.push(n); continue } if (s.length > 24000) { skipped.push(n + " (over 24 KB)"); continue } out[n] = JSON.parse(s) } catch (e) { skipped.push(n + " (not JSON)") } }' +
    ' return JSON.stringify({ vars: out, skipped }) };\n'
  src += 'const __restore = o => { for (const k of Object.keys(o || {})) { globalThis[k] = o[k]; __names.add(k) } };\n'
  src += 'const __libSet = (n, src) => { try { const f = (0, eval)("(" + src + "\\n)"); if (typeof f !== "function") throw new Error("not a function"); __lib[n] = f } catch (e) { const msg = String(e && e.message || e); __lib[n] = () => { throw new Error("lib." + n + " failed to load: " + msg) } } };\n'
  src += 'const __libLoad = entries => { for (const k of Object.keys(__lib)) delete __lib[k]; for (const [n, s] of entries) __libSet(n, s) };\n'
  return src
}

function prefixFor(rw) {
  return (rw.names.length ? '__declare(' + rw.names.map(n => JSON.stringify(n)).join(',') + ');' : '') + rw.keep.map(n => '__keep(' + JSON.stringify(n) + ', ' + n + ');').join('')
}

// ---------- lib.def: refuse code that won't survive being rebuilt from its source ----------
function freeNames(node) {
  const declared = new Set(), refs = new Set()
  const visit = (n, parent, key) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'Identifier') {
      if (parent) {
        if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return
        if ((parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && key === 'key' && !parent.computed && !parent.shorthand) return
        if (['LabeledStatement', 'BreakStatement', 'ContinueStatement'].includes(parent.type)) return
      }
      refs.add(n.name); return
    }
    if (n.type === 'VariableDeclarator') collectPattern(n.id, []).forEach(x => declared.add(x))
    if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') { if (n.id) declared.add(n.id.name); for (const p of n.params) collectPattern(p, []).forEach(x => declared.add(x)) }
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) declared.add(n.id.name)
    if (n.type === 'CatchClause' && n.param) collectPattern(n.param, []).forEach(x => declared.add(x))
    for (const k of Object.keys(n)) {
      if (k === 'type' || k === 'start' || k === 'end') continue
      const v = n[k]
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, n, k) }
      else if (v && typeof v.type === 'string') visit(v, n, k)
    }
  }
  visit(node, null, null)
  return [...refs].filter(x => !declared.has(x))
}
function paramsOf(fn) { return fn.params.map(p => p.type === 'Identifier' ? p.name : p.type === 'AssignmentPattern' && p.left.type === 'Identifier' ? p.left.name + '?' : p.type === 'RestElement' ? '...' + (p.argument.name || 'rest') : p.type === 'ObjectPattern' ? '{' + collectPattern(p, []).join(', ') + '}' : '[…]') }
function checkLib(name, source, api) {
  if (!/^[A-Za-z_$][\w$]{0,40}$/.test(name || '')) return { problem: 'lib.def: names are identifiers, like checkAll' }
  if (['def', 'list', 'remove', 'source'].includes(name)) return { problem: 'lib.def: "' + name + '" is taken by lib itself' }
  if (/\[native code\]/.test(source)) return { problem: 'lib.def: that is a built-in function; write your own' }
  let fn
  try { fn = acorn.parseExpressionAt(source, 0, { ecmaVersion: 'latest' }) } catch (e) { return { problem: 'lib.def: could not parse the function: ' + e.message } }
  if (!['FunctionExpression', 'ArrowFunctionExpression'].includes(fn.type) || source.slice(fn.end).trim()) return { problem: 'lib.def: pass one function (function name(…) {…}, async too, or an arrow)' }
  const { ns, flat } = apiShape(api)
  const allowed = new Set([...CLEAN_GLOBALS, ...Object.keys(ns), ...flat, ...CORE_NAMES, 'lib', 'console', 'sleep', 'arguments', 'vars', 'forget', 'undefined', 'NaN', 'Infinity', 'globalThis'])
  const free = freeNames(fn).filter(x => !allowed.has(x))
  if (free.length) return { problem: 'lib.def refuses ' + name + ': it uses ' + free.map(x => '`' + x + '`').join(', ') + ' from outside the function, which would not exist when it is rebuilt from its source. Pass ' + (free.length > 1 ? 'them' : 'it') + ' as arguments, or define ' + (free.length > 1 ? 'them' : 'it') + ' inside.' }
  if (QJS) {
    const vm = QJS.newContext()
    try { const r = vm.evalCode('(' + source + '\n)', 'lib.js'); if (r.error) { const d = vm.dump(r.error); r.error.dispose(); return { problem: 'lib.def: it does not compile on its own: ' + (d && d.message || d) } } r.value.dispose() }
    finally { vm.dispose() }
  }
  return { params: paramsOf(fn) }
}

// ---------- error messages that point at the fix ----------
function lev(a, b) { const m = []; for (let i = 0; i <= b.length; i++) m[i] = [i]; for (let j = 0; j <= a.length; j++) m[0][j] = j; for (let i = 1; i <= b.length; i++) for (let j = 1; j <= a.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1)); return m[b.length][a.length] }
function explain(err, m, known) {
  const msg = String(err.message || '')
  const ref = /^'?([\w$]+)'? is not defined/.exec(msg)
  if (ref) {
    const { ns, flat } = apiShape(m.api || [])
    const pool = [...Object.keys(ns), ...flat, 'lib', 'vars', 'forget', 'sleep', ...known, ...(m.lib || []).map(l => 'lib.' + l.name)]
    let best = null, bd = Math.max(2, Math.floor(ref[1].length / 3)) + 1
    for (const n of pool) { const d = lev(ref[1].toLowerCase(), n.toLowerCase()); if (d < bd) { bd = d; best = n } }
    if (best) err.message = msg + '. Did you mean ' + best + '?'
    else if (m.sid) err.message = msg + '. Variables kept from earlier evals: ' + (known.join(', ') || 'none')
  }
  if (/is read-only|Assignment to constant|not a function/.test(msg)) {
    const nm = /'?([\w$]+)'? is read-only/.exec(msg)
    if (nm && reservedFor(m.api || []).has(nm[1])) err.message = msg + ': ' + nm[1] + ' belongs to the API; pick another name'
  }
  return err
}

function cut(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + `… [${s.length - n} more characters cut]` : s }

// ---------- engine 1: QuickJS, one context per session ----------
const sessions = new Map()          // sid -> {vm, libHash}
const MAX_SESSIONS = 8
function dropSession(sid) { const S = sessions.get(sid); if (S) { sessions.delete(sid); try { S.vm.dispose() } catch (e) { } } }
function evalIn(vm, src, ms = 3000) {
  vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms))
  const r = vm.evalCode(src, 'internal.js')
  if (r.error) { const d = vm.dump(r.error); r.error.dispose(); throw new Error(d && d.message || String(d)) }
  const v = vm.dump(r.value); r.value.dispose(); return v
}
function newSession(api, sigs, roles) {
  const vm = QJS.newContext()
  vm.runtime.setMemoryLimit(64 * 1024 * 1024)
  vm.runtime.setMaxStackSize(1024 * 1024)
  // placeholders so the prelude's closures resolve; each eval installs its own bridge
  for (const n of ['__host', '__log']) { const f = vm.newFunction(n, () => vm.undefined); vm.setProp(vm.global, n, f); f.dispose() }
  evalIn(vm, preludeSource(api, sigs, roles))
  evalIn(vm, CORE, 5000)
  return { vm, libHash: '', api: api.join(',') + '|' + roles.join(',') }
}
function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619) } return (x >>> 0).toString(36) }

async function runQuick(m) {
  // long: the calls that may wait on a person or a model (the page's API table says which)
  const { id: eid, code, api, timeoutMs = 20000, sid, restore, lib, sigs = {}, roles = [], long = [] } = m
  const LONG = new Set(long)
  let S = sid ? sessions.get(sid) : null, fresh = false
  if (S && S.api !== api.join(',') + '|' + roles.join(',')) { dropSession(sid); S = null }
  if (!S) {
    S = newSession(api, sigs, roles); fresh = true
    if (restore && Object.keys(restore).length) { try { evalIn(S.vm, '__restore(' + JSON.stringify(restore) + ')') } catch (e) { /* a bad snapshot only loses the variables */ } }
    if (sid) { sessions.set(sid, S); while (sessions.size > MAX_SESSIONS) dropSession(sessions.keys().next().value) }
  } else { sessions.delete(sid); sessions.set(sid, S) }
  const vm = S.vm, rt = vm.runtime
  const lh = hash(JSON.stringify(lib || []))
  if (S.libHash !== lh) { try { evalIn(vm, '__libLoad(' + JSON.stringify((lib || []).map(l => [l.name, l.source])) + ')') } catch (e) { } S.libHash = lh }

  const logs = [], deferreds = new Set()
  let dead = false, longPending = 0, extra = 0, pausedAt = 0
  const deadline = Date.now() + timeoutMs
  const overdue = () => longPending === 0 && Date.now() > deadline + extra
  const pump = () => { if (dead) return; const r = rt.executePendingJobs(); if (r.error) r.error.dispose() }
  const settle = (d, ok, v) => {
    if (dead || !d.alive) return
    if (ok) { const h = vm.newString(JSON.stringify(v === undefined ? null : v)); d.resolve(h); h.dispose() }
    else { const h = vm.newError({ name: v.kind || 'Error', message: v.message }); d.reject(h); h.dispose() }
  }
  const hostFn = vm.newFunction('__host', (nameH, argsH) => {
    const name = vm.getString(nameH)
    const args = JSON.parse(vm.getString(argsH))
    const d = vm.newPromise()
    deferreds.add(d)
    let p
    if (name === 'lib.def') {
      const [lname, source, opts] = args
      const chk = checkLib(lname, source, api)
      p = chk.problem ? Promise.reject(Object.assign(new Error(chk.problem), { kind: 'LibError' }))
        : hostCall(eid, 'lib.def', [lname, source, opts || {}, chk.params]).then(v => { if (!dead) { try { evalIn(vm, '__libSet(' + JSON.stringify(lname) + ',' + JSON.stringify(source) + ')') } catch (e) { } } return v })
    } else p = hostCall(eid, name, args)
    if (LONG.has(name)) { if (longPending++ === 0) pausedAt = Date.now(); p = p.finally(() => { if (--longPending === 0) extra += Date.now() - pausedAt }) }
    p.then(v => settle(d, true, v), err => settle(d, false, { kind: err.kind, message: err.message }))
      .finally(() => { deferreds.delete(d); pump() })
    return d.handle
  })
  vm.setProp(vm.global, '__host', hostFn); hostFn.dispose()
  const logFn = vm.newFunction('__log', (lvlH, sH) => { logs.push({ level: vm.getString(lvlH), text: cut(vm.getString(sH), 2000) }) })
  vm.setProp(vm.global, '__log', logFn); logFn.dispose()

  const rw = sid ? rewrite(code, reservedFor(api)) : { code, names: [], keep: [] }
  // line 1 of the person's code is line 2 of eval.js
  const src = '(async () => {' + prefixFor(rw) + '\n' + rw.code + '\n})().then(v => JSON.stringify(v === undefined ? null : v))'
  const snapshot = () => { try { return JSON.parse(evalIn(vm, '__snapshot()')) } catch (e) { return null } }
  const known = () => { try { return evalIn(vm, '[...__names]') } catch (e) { return [] } }
  const finish = out => {
    dead = true
    for (const d of deferreds) { try { d.dispose() } catch (e) { /* already gone */ } }
    if (sid) { out.scope = snapshot(); out.known = known(); out.fresh = fresh }
    else { try { vm.dispose() } catch (e) { } }
    return out
  }
  const qerr = (dumped, fallbackKind) => {
    const e = typeof dumped === 'object' && dumped ? dumped : { message: String(dumped) }
    let line = null
    const mm = /eval\.js:(\d+)/.exec(e.stack || '')
    if (mm) line = Number(mm[1]) - 1
    const kind = e.name && e.name !== 'Error' ? e.name : fallbackKind
    return { kind, message: String(e.message || e), line: line > 0 ? line : null }
  }

  rt.setInterruptHandler(overdue)
  const res = vm.evalCode(src, 'eval.js')
  if (res.error) {
    const d = vm.dump(res.error); res.error.dispose()
    return finish({ ok: false, error: qerr(d, 'SyntaxError'), logs })
  }
  const promise = vm.resolvePromise(res.value)
  res.value.dispose()
  pump()
  let timer
  const timeout = new Promise(r => { const tick = () => { if (overdue()) r({ timeout: true }); else timer = setTimeout(tick, 200) }; timer = setTimeout(tick, 200) })
  const settled = await Promise.race([promise, timeout])
  clearTimeout(timer)
  if (settled.timeout) return finish({ ok: false, error: { kind: 'timeout', message: `eval ran longer than ${Math.round(timeoutMs / 1000)} s`, line: null }, logs })
  if (settled.error) {
    const d = vm.dump(settled.error); settled.error.dispose()
    return finish({ ok: false, error: qerr(d, 'Error'), logs })
  }
  const s = vm.getString(settled.value); settled.value.dispose()
  let value = null
  try { value = JSON.parse(s) } catch (e) { value = s }
  return finish({ ok: true, value, logs })
}

// ---------- engine 2: this worker's realm (scope kept in an object, read through `with`) ----------
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const plainScopes = new Map()
async function runPlain({ id: eid, code, api, timeoutMs = 20000, sid, restore, lib }) {
  const logs = []
  let S = sid && plainScopes.get(sid), fresh = false
  if (!S) { S = Object.create(null); Object.assign(S, restore || {}); fresh = true; if (sid) plainScopes.set(sid, S) }
  const names = new Set(Object.keys(S))
  const hostP = (n, a) => {
    const args = JSON.parse(a)
    if (n === 'lib.def') { const chk = checkLib(args[0], args[1], api); if (chk.problem) return Promise.reject(Object.assign(new Error(chk.problem), { kind: 'LibError' })); args[3] = chk.params }
    return hostCall(eid, n, args).then(v => JSON.stringify(v === undefined ? null : v))
  }
  const scope = {
    __host: hostP, __log: (level, text) => logs.push({ level, text: cut(text, 2000) }),
    __declare: (...n) => { for (const x of n) { names.add(x); if (!(x in S)) S[x] = undefined } }, __keep: (n, v) => { S[n] = v; names.add(n) }
  }
  const pre = preludeSource(api, arguments[0].sigs, arguments[0].roles).replace(/^const (__names|__declare|__keep) = .*$/gm, '') + CORE + '\n'
  const rw = sid ? rewrite(code, reservedFor(api)) : { code, names: [], keep: [] }
  for (const n of rw.names) if (!(n in S)) S[n] = undefined
  const libLoad = '__libLoad(' + JSON.stringify((lib || []).map(l => [l.name, l.source])) + ');\n'
  const preludeLines = (pre + libLoad).split('\n').length - 1
  let fn
  try { fn = new AsyncFunction('__host', '__log', '__declare', '__keep', '__S', 'const __names = { add() {}, delete() {}, has: () => false, [Symbol.iterator]: function* () {} };\n' + pre + libLoad + 'with (__S) {' + prefixFor(rw) + '\n' + rw.code + '\n}') }
  catch (err) { return { ok: false, error: { kind: 'SyntaxError', message: err.message, line: null }, logs } }
  let timer
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error(`eval ran longer than ${Math.round(timeoutMs / 1000)} s`), { kind: 'timeout' })), timeoutMs) })
  const snap = () => { const vars = {}, skipped = []; for (const n of names) { const v = S[n]; if (typeof v === 'function') { skipped.push(n + ' (a function: save it with lib.def to keep it)'); continue } try { const s = JSON.stringify(v); if (s !== undefined && s.length <= 24000) vars[n] = JSON.parse(s); else skipped.push(n) } catch (e) { skipped.push(n + ' (not JSON)') } } return { vars, skipped } }
  try {
    const v = await Promise.race([fn(scope.__host, scope.__log, scope.__declare, scope.__keep, S), timeout])
    clearTimeout(timer)
    return { ok: true, value: JSON.parse(JSON.stringify(v === undefined ? null : v)), logs, scope: sid ? snap() : undefined, fresh, known: [...names] }
  } catch (err) {
    clearTimeout(timer)
    let line = null
    const mm = /<anonymous>:(\d+)/.exec(err && err.stack || '')
    if (mm) line = Number(mm[1]) - 3 - preludeLines
    return { ok: false, error: { kind: err.kind || err.name || 'Error', message: String(err && err.message || err), line: line > 0 ? line : null }, logs, scope: sid ? snap() : undefined, fresh, known: [...names] }
  }
}
