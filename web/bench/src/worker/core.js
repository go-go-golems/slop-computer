// The agentalg core, evaluated in every sandbox session after the prelude.
// Terms: step id seq par alt loop dyn llm delegate. Wrappers: retry timeout fallback guard verify tap approve named atomic.
// Module verbs (files.read, frames.check, …) return steps. A step is a plan; awaiting it (or .run()) runs it, so the
// direct style `await files.read(p)` keeps working, and `.then(next)` with one argument composes instead.
// Schemas `s`, monoids, help(), tx(fn). The host API is reached only through __call.

const __STEP_METHODS = ['then', 'run', 'catch', 'finally', 'output', 'tier', 'map', 'fold', 'retry', 'timeout', 'fallback', 'guard', 'verify', 'tap', 'approve', 'named', 'atomic', 'dry', 'explain', 'toJSON', 'toString']
const __PASS_STEP = ['constructor', 'valueOf', 'inspect', 'prototype', '$$typeof', 'asymmetricMatch', 'nodeType', 'kind', 'kids', 'label', '__step', '__loop', '__ns', 'verb', 'build']
const __PASSTHROUGH = ['policy', 'approval', 'budget', 'cancelled']
const __WRITE = /^(files\.(write|replace|remove)|data\.(define|insert|update|remove|drop)|lib\.(def|remove)|ui\.(resolvePin|pin))$/
const __CANVAS = /^frames\.(open|update|move|label|close|arrange)$/

function __err(kind, message) { const e = new Error(message); e.name = kind; e.kind = kind; return e }
function __ekind(e) { if (e && typeof e === 'object' && !e.kind) e.kind = e.name && e.name !== 'Error' ? e.name : 'error'; return e }
const __isStep = v => !!v && (typeof v === 'object' || typeof v === 'function') && v.__step === true
function __ms(t) { if (typeof t === 'number') return t; const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(String(t).trim()); if (!m) throw __err('invalid', 'timeout takes ms or "30s" / "3m"'); return +m[1] * ({ ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2] || 'ms']) }
function __fnLabel(f) { const s = String(f); return (f.name && !/^(anonymous)?$/.test(f.name) ? f.name : s.replace(/\s+/g, ' ').slice(0, 48)) }

class __Step {
  constructor(kind, props) { this.kind = kind; Object.assign(this, props) }
  get __step() { return true }
  // await / Promise.resolve call then(resolve, reject): run. One argument: compose.
  then(a, b) {
    if (arguments.length === 2 && typeof a === 'function' && typeof b === 'function' && !__isStep(a)) return this.run().then(a, b)
    if (a === undefined) throw __err('invalid', '.then(next) composes: pass a step or a function')
    return seq(this, __toStep(a))
  }
  run(input) { return __exec(this, input, { input }) }
  catch(f) { return this.run().catch(f) }
  finally(f) { return this.run().finally(f) }
  map(o = {}) { return __mk('map', { body: this, concurrency: o.concurrency || 4 }) }
  fold(m, init) { return __mk('fold', { body: this, m, init }) }
  retry(o = {}) { return __wrap(this, 'retry', typeof o === 'number' ? { times: o } : o) }
  timeout(t) { return __wrap(this, 'timeout', { ms: __ms(t) }) }
  fallback(other, o = {}) { return __wrap(this, 'fallback', { other: __toStep(other), when: o.when }) }
  guard(pred, msg) { return __wrap(this, 'guard', { pred, msg }) }
  verify(pred, msg) { return __wrap(this, 'verify', { pred, msg }) }
  tap(fn) { return __wrap(this, 'tap', { fn }) }
  approve(o = {}) { return __wrap(this, 'approve', typeof o === 'string' ? { title: o } : o) }
  named(name) { return __wrap(this, 'named', { name: String(name) }) }
  atomic() { return __wrap(this, 'atomic', {}) }
  async dry(input) {
    await __call('dry.begin', [])
    let out, err
    try { out = await __exec(this, input, { input }) } catch (e) { err = e }
    const cs = await __call('dry.end', [])
    if (err) { __ekind(err); err.message += ' · dry run discarded ' + cs.files.length + ' captured write(s)'; throw err }
    return __changeset(cs, out)
  }
  explain() { return __explain(this) }
  output(sch) { if (this.kind !== 'llm') throw __err('invalid', '.output(schema) belongs to llm`…` steps; for delegate pass { output } in its options'); if (!sch || !sch.check) throw __err('invalid', '.output takes a schema: s.object({…}), s.enum([…]), …'); return __mk('llm', { ...this, schema: sch }) }
  tier(n) { if (this.kind !== 'llm') throw __err('invalid', '.tier(name) belongs to llm`…` steps'); return __mk('llm', { ...this, tierName: n }) }
  toJSON() { return 'Step (not run: await it or .run())\n' + __explain(this) }
  toString() { return this.toJSON() }
}
const __STEP_TRAP = {
  get(t, k, r) {
    if (typeof k !== 'string' || k in t || __PASS_STEP.includes(k)) return Reflect.get(t, k, r)
    const near = __near(k, __STEP_METHODS)
    throw new TypeError('.' + k + ' is not a method of a Step (' + __label(t) + ').' + (near ? ' Did you mean .' + near + '?' : '') +
      ' A Step is a plan, not its output: run it (await it, or .run()) to get the value. Steps have: ' + __STEP_METHODS.slice(4).join(', '))
  }
}
function __mk(kind, props) { return new Proxy(new __Step(kind, props), __STEP_TRAP) }
function __wrap(inner, w, o) { return __mk('wrap', { inner, w, o }) }
function __toStep(v) {
  if (v && v.__loop === true) return v.build()
  if (__isStep(v)) return v
  if (typeof v === 'function') return step(v)
  if (Array.isArray(v)) return par(v)
  if (v && typeof v === 'object' && Object.values(v).some(x => __isStep(x) || typeof x === 'function')) return par(v)
  return step(() => v, JSON.stringify(v))
}
function __label(t) {
  switch (t.kind) {
    case 'tool': return t.verb + '(' + t.args.map(a => typeof a === 'function' ? 'ƒ' : a instanceof RegExp ? String(a) : JSON.stringify(a)).join(', ').slice(0, 60) + ')'
    case 'pure': return 'step ' + (t.label || __fnLabel(t.fn))
    case 'wrap': return t.w === 'named' ? t.o.name : __label(t.inner)
    case 'delegate': return 'delegate ' + t.role
    default: return t.kind
  }
}

function __tool(verb, args) { return __mk('tool', { verb, args }) }

// ---------- terms ----------
function step(fn, label) { if (typeof fn !== 'function') throw __err('invalid', 'step(fn): fn is (input, { input }) => value'); return __mk('pure', { fn, label }) }
function id() { return __mk('id', {}) }
function seq(...kids) { const flat = []; for (const k of kids.flat()) { const s = __toStep(k); if (s.kind === 'seq') flat.push(...s.kids); else flat.push(s) } return __mk('seq', { kids: flat }) }
function par(branches) {
  if (Array.isArray(branches)) return __mk('par', { kids: branches.map(__toStep) })
  if (branches && typeof branches === 'object') return __mk('par', { kids: Object.fromEntries(Object.entries(branches).map(([k, v]) => [k, __toStep(v)])) })
  throw __err('invalid', 'par takes an array or an object of steps')
}
function alt(branches) {
  const kids = Object.fromEntries(Object.entries(branches || {}).map(([k, v]) => [k, __toStep(v)]))
  return Object.freeze({ by: router => __mk('alt', { kids, router }), toJSON: () => 'alt({…}) needs .by(router): a function or a step that returns a branch name' })
}
function loop(body) {
  const o = { body: __toStep(body), seed: null, until: null, max: 5, keep: 'last', score: null }
  const b = {
    __loop: true,
    seed(s) { o.seed = __toStep(s); return b }, until(f) { o.until = f; return b }, max(n) { o.max = n; return b },
    keep(how, score) { o.keep = how; o.score = score; return b }, build() { return __mk('loop', { ...o }) }
  }
  // the builder is itself a step once complete enough: delegate the step protocol to a built term
  const p = new Proxy(b, { get(t, k) { if (k in t) return k === 'seed' || k === 'until' || k === 'max' || k === 'keep' ? (...a) => { t[k](...a); return p } : t[k]; const s = t.build(); const v = s[k]; return typeof v === 'function' ? v.bind(s) : v } })
  return p
}
function dyn(fn, o = {}) { return __mk('dyn', { fn, label: o.label }) }
function llm(strings, ...holes) {
  if (typeof strings === 'string') { strings = [strings]; holes = [] }
  return __mk('llm', { strings: [...strings], holes, schema: null, tierName: 'quick' })
}
function delegate(role, task, opts = {}) {
  if (typeof role !== 'string') throw __err('invalid', 'delegate(role, task, { output, evals, tier }): role is one of ' + (__ROLES.join(', ')))
  return __mk('delegate', { role, task, opts })
}

// ---------- running ----------
const __FIRST = {}
for (const [v, sig] of Object.entries(__SIGS)) { const p = (sig.split(',')[0] || '').trim(); if (p === 'path') __FIRST[v] = 'path'; else if (p === 'frameId' || p === 'frameId?') __FIRST[v] = 'id'; else if (p === 'table') __FIRST[v] = 'name' }
async function __exec(t, x, rc) {
  switch (t.kind) {
    case 'tool': return __runTool(t, x, rc)
    case 'pure': {
      let v = t.fn(x, { input: rc.input })
      if (!__isStep(v)) v = await v
      if (__isStep(v)) throw __err('pure', 'a pure step returned a Step; here it is a value and never runs. Compose with .then(…), or use dyn(…) when the shape is decided at run time')
      return v
    }
    case 'id': return x
    case 'seq': { let v = x; for (const k of t.kids) v = await __exec(k, v, rc); return v }
    case 'par': {
      if (Array.isArray(t.kids)) return Promise.all(t.kids.map(k => __exec(k, x, rc)))
      const ks = Object.keys(t.kids), vs = await Promise.all(ks.map(k => __exec(t.kids[k], x, rc)))
      // named results that also destructure as a list, in key order: const [status, logs] = await par({ status, logs })
      // failed twice in round 4 ("value is not iterable")
      const out = Object.fromEntries(ks.map((k, i) => [k, vs[i]]))
      Object.defineProperty(out, Symbol.iterator, { value: function* () { yield* vs }, enumerable: false })
      return out
    }
    case 'alt': {
      const key = __isStep(t.router) ? await __exec(t.router, x, rc) : await t.router(x, { input: rc.input })
      const b = t.kids[key] || t.kids.default || t.kids.other
      if (!b) throw __err('route', 'alt: no branch "' + key + '" (branches: ' + Object.keys(t.kids).join(', ') + ')')
      return __exec(b, x, rc)
    }
    case 'map': {
      if (!Array.isArray(x)) throw __err('type', '.map() runs its step once per element; its input here is ' + (x === null ? 'null' : typeof x) + ', not an array')
      const out = new Array(x.length); let i = 0
      await Promise.all(Array.from({ length: Math.max(1, Math.min(t.concurrency, x.length)) }, async () => { while (i < x.length) { const k = i++; out[k] = await __exec(t.body, x[k], rc) } }))
      return out
    }
    case 'fold': {
      const arr = await __exec(t.body, x, rc)
      if (!Array.isArray(arr)) throw __err('type', '.fold() needs its step to output an array')
      if (typeof t.m === 'function') return t.init === undefined ? arr.reduce(t.m) : arr.reduce(t.m, t.init)
      return arr.map(t.m.of || (v => v)).reduce(t.m.concat, t.m.empty)
    }
    case 'loop': {
      let st = t.seed ? await __exec(t.seed, x, rc) : x, best = st, bestScore = t.score ? await t.score(st) : 0
      for (let i = 0; i < t.max; i++) {
        if (t.until && await t.until(st)) break
        st = await __exec(t.body, st, rc)
        if (t.keep === 'best' && t.score) { const sc = await t.score(st); if (sc > bestScore) { best = st; bestScore = sc } }
      }
      return t.keep === 'best' && t.score ? best : st
    }
    case 'dyn': return t.fn(x, { input: rc.input, run: (term, inp) => __exec(__toStep(term), inp === undefined ? x : inp, rc) })
    case 'llm': {
      let text = ''
      for (let i = 0; i < t.strings.length; i++) {
        text += t.strings[i]
        if (i < t.holes.length) { const hv = t.holes[i]; const v = typeof hv === 'function' ? await hv(x, { input: rc.input }) : typeof hv === 'string' && x && typeof x === 'object' && hv in x ? x[hv] : hv; text += typeof v === 'string' ? v : JSON.stringify(v) }
      }
      const out = await __call('llm', [text, { output: t.schema ? t.schema.toText() : null, tier: t.tierName }])
      if (t.schema) { const bad = t.schema.check(out); if (bad.length) throw __err('schema', 'llm reply does not match ' + t.schema.toText() + ': ' + bad.slice(0, 3).join('; ')) }
      return out
    }
    case 'delegate': {
      const task = typeof t.task === 'function' ? await t.task(x, { input: rc.input }) : t.task === undefined ? x : t.task
      const o = { ...t.opts }; const sch = o.output; if (sch && sch.toText) o.output = sch.toText()
      const r = await __call('agents.delegate', [t.role, typeof task === 'string' ? task : JSON.stringify(task), o])
      if (sch && sch.check) { const bad = sch.check(r.result); if (bad.length) throw __err('schema', t.role + ' replied outside ' + sch.toText() + ': ' + bad.slice(0, 3).join('; ')) }
      return r
    }
    case 'wrap': return __runWrap(t, x, rc)
  }
  throw __err('invalid', 'unknown term ' + t.kind)
}
async function __runTool(t, x, rc) {
  const args = []
  for (const a of t.args) args.push(typeof a === 'function' && !__isStep(a) ? await a(x, { input: rc.input }) : a)
  // a missing first argument comes from the input: files.list().then(files.read().map())
  if ((args.length === 0 || args[0] === undefined) && x !== undefined && __FIRST[t.verb]) {
    if (Array.isArray(x)) throw __err('type', t.verb + ' acts on one ' + __FIRST[t.verb] + '; its input here is an array of ' + x.length + '. Lift it with .map(): ….then(' + t.verb + '().map())')
    args[0] = x && typeof x === 'object' ? (x[__FIRST[t.verb]] ?? x.path ?? x.id) : x
  }
  for (let i = 0; i < args.length; i++) if (args[i] instanceof RegExp) { const re = args[i]; args[i] = re.source; if (t.verb === 'files.grep' && re.flags) args[i + 1] = { flags: re.flags, ...(args[i + 1] || {}) } }
  return __call(t.verb, args)
}
async function __runWrap(t, x, rc) {
  const o = t.o, inner = t.inner
  switch (t.w) {
    case 'named': return __exec(inner, x, rc)
    case 'retry': {
      const times = o.times ?? 2
      for (let a = 0; ; a++) {
        try { return await __exec(inner, x, rc) }
        catch (e) { __ekind(e); if (__PASSTHROUGH.includes(e.kind) || a >= times || (o.when && !o.when(e))) throw e; await sleep(Math.min(2000, 150 * 2 ** a)) }
      }
    }
    case 'timeout': {
      let timer
      try { return await Promise.race([__exec(inner, x, rc), new Promise((_, rej) => { timer = setTimeout(() => rej(__err('timeout', __label(inner) + ' took longer than ' + o.ms + ' ms')), o.ms) })]) }
      finally { clearTimeout(timer) }
    }
    case 'fallback': {
      try { return await __exec(inner, x, rc) }
      catch (e) { __ekind(e); if (__PASSTHROUGH.includes(e.kind) || (o.when && !o.when(e))) throw e; return __exec(o.other, x, rc) }
    }
    case 'guard': { if (!(await o.pred(x, { input: rc.input }))) throw __err('guard', o.msg || 'guard failed before ' + __label(inner)); return __exec(inner, x, rc) }
    case 'verify': { const v = await __exec(inner, x, rc); if (!(await o.pred(v, { input: rc.input }))) throw __err('verify', o.msg || 'verify failed after ' + __label(inner)); return v }
    case 'tap': { const v = await __exec(inner, x, rc); await o.fn(v); return v }
    case 'approve': {
      const ok = await __call('ui.approve', [o.title || 'Run ' + __label(inner) + '?', o.detail ? String(typeof o.detail === 'function' ? await o.detail(x) : o.detail) : __explain(inner)])
      if (!ok) throw __err('approval', 'not approved: ' + (o.title || __label(inner)))
      return __exec(inner, x, rc)
    }
    case 'atomic': {
      await __call('tx.begin', [])
      try { const v = await __exec(inner, x, rc); await __call('tx.commit', []); return v }
      catch (e) { __ekind(e); const undone = await __call('tx.rollback', []); e.message += ' · atomic rolled back: ' + (undone.join(', ') || 'nothing'); throw e }
    }
  }
}
function setTimeout(f, ms) { return __timer(f, ms) }
function clearTimeout(t) { if (t) t.cancelled = true }
function __timer(f, ms) { const t = { cancelled: false }; sleep(ms).then(() => { if (!t.cancelled) f() }); return t }
function tx(fn) { return dyn(fn, { label: 'tx' }).atomic().run() }

// ---------- dry runs: writes captured into a changeset ----------
function __changeset(cs, output) {
  const make = files => Object.freeze({
    output, files,
    diff: cs.diff,
    only(pred) { return make(files.filter(f => typeof pred === 'function' ? pred(f) : [].concat(pred).includes(f.path))) },
    apply() { return __call('dry.apply', [cs.id, files.map(f => f.path)]) },
    discard() { return __call('dry.discard', [cs.id]) },
    toJSON() { return { changeset: files.length + ' file(s)', files: files.map(f => f.change + ' ' + f.path + (f.add != null ? ' +' + f.add + ' −' + f.del : '')), output, apply: 'await cs.apply()', diff: String(cs.diff || '').slice(0, 3000) } }
  })
  return make(cs.files)
}

// ---------- explain ----------
function __effect(t) {
  if (t.kind === 'tool') return __WRITE.test(t.verb) ? 'write' : __CANVAS.test(t.verb) ? 'canvas' : 'read'
  if (t.kind === 'llm') return 'llm'
  if (t.kind === 'delegate') return 'agent'
  if (t.kind === 'dyn') return 'opaque'
  return null
}
function __explain(root) {
  const lines = [], effects = new Set()
  const walk = (t, d, deco) => {
    const pad = '  '.repeat(d), e = __effect(t)
    if (e) effects.add(e)
    if (t.kind === 'wrap') {
      const tag = t.w === 'retry' ? 'retry×' + (t.o.times ?? 2) : t.w === 'timeout' ? '⏱' + t.o.ms + 'ms' : t.w === 'named' ? '“' + t.o.name + '”' : t.w
      if (t.w === 'fallback') { walk(t.inner, d, [...deco, 'fallback ↓']); lines.push(pad + '  ⇢ on error'); walk(t.o.other, d + 2, []); return }
      return walk(t.inner, d, [...deco, tag])
    }
    const tags = deco.length ? '  [' + deco.join(' ') + ']' : ''
    if (t.kind === 'seq') { lines.push(pad + 'seq' + tags); t.kids.forEach(k => walk(k, d + 1, [])); return }
    if (t.kind === 'par') { lines.push(pad + 'par ∥' + Object.keys(t.kids).length + tags); for (const [k, v] of Object.entries(t.kids)) { if (!Array.isArray(t.kids)) lines.push(pad + '  ' + k + ':'); walk(v, d + (Array.isArray(t.kids) ? 1 : 2), []) } return }
    if (t.kind === 'alt') { lines.push(pad + 'alt by ' + (__isStep(t.router) ? __label(t.router) : __fnLabel(t.router)) + tags); for (const [k, v] of Object.entries(t.kids)) { lines.push(pad + '  ' + k + ':'); walk(v, d + 2, []) } return }
    if (t.kind === 'map') { lines.push(pad + 'map ×' + t.concurrency + tags); walk(t.body, d + 1, []); return }
    if (t.kind === 'fold') { lines.push(pad + 'fold' + tags); walk(t.body, d + 1, []); return }
    if (t.kind === 'loop') { lines.push(pad + 'loop max ' + t.max + (t.keep === 'best' ? ' keep best' : '') + tags); if (t.seed) { lines.push(pad + '  seed:'); walk(t.seed, d + 2, []) } walk(t.body, d + 1, []); return }
    lines.push(pad + __label(t) + (e ? '   ' + e : '') + tags)
  }
  walk(root, 1, [])
  return 'plan · effects: ' + ([...effects].join(', ') || 'pure') + '\n' + lines.join('\n')
}

// ---------- schemas ----------
const __SP = {
  describe(d) { return __sch({ ...this, desc: d }) }, optional() { return __sch({ ...this, opt: true }) }, default(v) { return __sch({ ...this, def: v, opt: true }) },
  min(n) { return __sch({ ...this, min: n }) }, max(n) { return __sch({ ...this, max: n }) },
  check(v, path = '') {
    const at = path || 'value', out = []
    if (v === undefined || v === null) { if (!this.opt) out.push(at + ' is missing'); return out }
    switch (this.type) {
      case 'string': if (typeof v !== 'string') out.push(at + ' should be a string'); break
      case 'number': case 'int': if (typeof v !== 'number' || (this.type === 'int' && !Number.isInteger(v))) out.push(at + ' should be ' + (this.type === 'int' ? 'an integer' : 'a number')); else { if (this.min != null && v < this.min) out.push(at + ' < ' + this.min); if (this.max != null && v > this.max) out.push(at + ' > ' + this.max) } break
      case 'boolean': if (typeof v !== 'boolean') out.push(at + ' should be true or false'); break
      case 'enum': if (!this.vals.includes(v)) out.push(at + ' should be one of ' + this.vals.map(x => JSON.stringify(x)).join(' | ')); break
      case 'array': if (!Array.isArray(v)) out.push(at + ' should be an array'); else v.forEach((x, i) => out.push(...this.item.check(x, at + '[' + i + ']'))); break
      case 'object': if (typeof v !== 'object' || Array.isArray(v)) out.push(at + ' should be an object'); else for (const [k, s2] of Object.entries(this.shape)) out.push(...s2.check(v[k], path ? path + '.' + k : k)); break
    }
    return out
  },
  toText() {
    const o = this.opt ? '?' : ''
    switch (this.type) {
      case 'enum': return this.vals.map(x => JSON.stringify(x)).join('|') + o
      case 'array': return this.item.toText() + '[]' + o
      case 'object': return '{' + Object.entries(this.shape).map(([k, s2]) => k + (s2.opt ? '?' : '') + ': ' + s2.toText().replace(/\?$/, '') + (s2.desc ? ' /* ' + s2.desc + ' */' : '')).join(', ') + '}' + o
      default: return this.type + o
    }
  },
  toJSON() { return this.toText() }
}
function __sch(o) { return Object.assign(Object.create(__SP), o) }
const s = Object.freeze({
  string: () => __sch({ type: 'string' }), number: () => __sch({ type: 'number' }), int: () => __sch({ type: 'int' }), boolean: () => __sch({ type: 'boolean' }),
  any: () => __sch({ type: 'any' }), enum: vals => __sch({ type: 'enum', vals }), array: item => __sch({ type: 'array', item }), object: shape => __sch({ type: 'object', shape })
})

// ---------- monoids for fold ----------
const monoid = Object.freeze({
  sum: { empty: 0, concat: (a, b) => a + b }, count: { empty: 0, of: () => 1, concat: (a, b) => a + b },
  concat: { empty: [], of: v => [].concat(v), concat: (a, b) => a.concat(b) }, merge: { empty: {}, concat: (a, b) => ({ ...a, ...b }) },
  max: { empty: -Infinity, concat: (a, b) => Math.max(a, b) }, min: { empty: Infinity, concat: (a, b) => Math.min(a, b) },
  groupBy: (key, inner = monoid.concat) => ({ empty: {}, of: v => ({ [key(v)]: (inner.of || (x => x))(v) }), concat: (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = k in o ? inner.concat(o[k], v) : v; return o } })
})

// ---------- help ----------
function help(x) {
  if (x === undefined) return [
    'terms     step(fn) id() seq(a, b, …) par([…] | {…}) alt({…}).by(router) loop(body).seed(s).until(f).max(n).keep("best", score) dyn(async (x, ctx) => ctx.run(term)) llm`…`.output(schema) delegate(role, task, { output, evals })',
    'wrappers  .retry({ times, when }) .timeout("30s") .fallback(step, { when }) .guard(pred, msg) .verify(pred, msg) .tap(fn) .approve(title) .named(name) .atomic()',
    'running   await step  ≡  step.run(input) · .then(next) composes · .map() lifts over arrays · .fold(monoid) · .dry() → changeset · .explain() → plan · tx(async () => …)',
    'schemas   s.string() s.number() s.int() s.boolean() s.enum([…]) s.array(item) s.object({…}) · .optional() .default(v) .describe(text)',
    'modules   ' + Object.keys(__byNs()).map(n => n + ' (' + __byNs()[n].length + ')').join(' · ') + ' · help(files.replace) for one verb',
    'roles     ' + __ROLES.join(', ') + ' · delegate(role, task) runs a subagent and returns its result',
    'scope     vars() forget(name) · lib.def(name, fn, { description }) lib.list()'
  ].join('\n')
  if (x && typeof x === 'object' && typeof x.__ns === 'string' && !__isStep(x)) return __byNs()[x.__ns] ? __byNs()[x.__ns].map(__line).join('\n') : x.__ns + ': no verbs'
  if (typeof x === 'function' && x.verb) { const v = x.verb; return __line(v) + '\n  a Step: await it to run it · effect ' + (__WRITE.test(v) ? 'write' : __CANVAS.test(v) ? 'canvas' : 'read') + (__FIRST[v] ? ' · a missing first argument comes from the input' : '') }
  if (__isStep(x)) return __explain(x)
  if (typeof x === 'string' && __byNs()[x]) return __byNs()[x].map(__line).join('\n')
  return 'help() lists everything; help(files) or help("files") a module; help(files.read) one verb; help(step) a plan'
}
// one verb as the reference shows it: name(sig) → what awaiting it gives — what it does
function __line(v) { const d = typeof __DOCS === 'object' && __DOCS[v]; return v + '(' + (__SIGS[v] || '') + ')' + (d ? ' ' + d : '') }
function __byNs() { const o = {}; for (const v of Object.keys(__SIGS)) { const [a] = v.split('.'); if (v.includes('.')) (o[a] = o[a] || []).push(v) } return o }
