// agent/types.js — the page's side of the type checker (SLOP3-024 phase 3).
//
// The checker is TypeScript in a worker of its own (src/checker/, built
// into checker.js): it outlives the QuickJS sandbox's restarts and stays
// warm, so a check after an eval takes tens of milliseconds. It loads only
// for an app with TypeScript files. A view is what to check: anything with
// list() → paths and read(path) → text (an eval's transaction, a Draft at
// its head, the person's live edits). The declarations are the app's
// app.types (the bench actor's types action), cached per app until a
// commit brings an instance up on new code (actions.d.ts follows the dev
// instance's actor).
//
// Results inform; they never fail anything. A check that does not answer in
// time says so ({skipped}).
//
// Owns: the checker worker, the declarations cache. Public API: Types
// (wants, check, info, transpile, invalidate, diff).
import { Slop } from '../server/slop.js';

const CODE = /\.(ts|tsx|mts|cts)$/
const RELEVANT = p => CODE.test(p) || p === 'app.json' || p === 'tsconfig.json' || p === 'vendor/tsconfig.vendor.json'

export const Types = {
  worker: null, state: 'off', version: '', seq: 0, waits: new Map(), decl: new Map(),

  // Whether a view is an app the checker looks at: it has TypeScript of its own.
  wants(view) {
    return view.list().some(p => CODE.test(p) && !p.endsWith('.d.ts') && !p.startsWith('vendor/') && !p.startsWith('node_modules/'))
  },
  // The view's files the checker reads, taken now (a later write does not change them).
  filesOf(view) {
    const out = {}
    for (const p of view.list()) if (RELEVANT(p)) { const t = view.read(p); if (typeof t === 'string') out[p] = t }
    return out
  },

  spawn() {
    if (this.worker) return
    this.state = 'loading'
    const attach = w => {
      w.onmessage = e => {
        const m = e.data || {}
        if (m.type === 'ready') { this.state = 'ready'; this.version = m.version; return }
        const wait = this.waits.get(m.id)
        if (wait) { this.waits.delete(m.id); wait(m) }
      }
      w.onerror = e => { e.preventDefault && e.preventDefault(); this.fail('the checker could not start') }
      this.worker = w
    }
    try { attach(new Worker('checker.js')) } catch {
      fetch('checker.js').then(r => r.text()).then(src => attach(new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))))
        .catch(() => this.fail('the checker could not load'))
    }
  },
  fail(why) {
    this.state = 'off'; this.worker = null
    for (const [, w] of this.waits) w({ ok: false, error: why })
    this.waits.clear()
  },
  // Sends a message; resolves with the answer, or {timeout} after ms (the
  // answer, when it comes, is dropped: the worker answers in order).
  post(msg, ms) {
    this.spawn()
    const id = ++this.seq
    return new Promise(resolve => {
      const t = setTimeout(() => { if (this.waits.delete(id)) resolve({ ok: false, timeout: true }) }, ms)
      this.waits.set(id, m => { clearTimeout(t); resolve(m) })
      const send = () => this.worker ? this.worker.postMessage({ ...msg, id }) : setTimeout(send, 50)
      send()
    })
  },

  // The app's declarations ({name: text}), fetched once per app until invalidated.
  declarations(P) {
    let d = this.decl.get(P.app)
    if (!d) {
      d = Slop.call('types', { app: P.app }).then(r => Object.fromEntries((r.files || []).map(f => [f.path, f.text])))
      d.catch(() => { if (this.decl.get(P.app) === d) this.decl.delete(P.app) })
      this.decl.set(P.app, d)
    }
    return d
  },
  invalidate(P) { this.decl.delete(P.app) },

  // Type errors in a view: {diags: [{file, line, col, code, message,
  // program}], ms} or {skipped: why}.
  async check(P, view, { timeoutMs = 2000 } = {}) {
    const files = this.filesOf(view)
    let decl
    try { decl = await this.declarations(P) } catch (e) { return { skipped: 'no declarations from the server: ' + (e.message || e) } }
    const r = await this.post({ type: 'check', files, decl }, timeoutMs)
    if (r.timeout) return { skipped: this.state === 'ready' ? 'the check took longer than ' + Math.round(timeoutMs / 1000) + ' s' : 'the checker was still loading' }
    if (!r.ok) return { skipped: r.error || 'the checker failed' }
    return { diags: r.diags, ms: r.ms }
  },
  // The type at a position in a file of the view: {text, doc} or null.
  async info(P, view, path, pos) {
    let decl
    try { decl = await this.declarations(P) } catch { return null }
    const r = await this.post({ type: 'info', files: this.filesOf(view), decl, path, pos }, 3000)
    return r.ok && r.text ? { text: r.text, doc: r.doc || '' } : null
  },
  // An eval's TypeScript body with its types stripped: {code} or {error, line}.
  async transpile(code) {
    const r = await this.post({ type: 'transpile', code }, 20000)
    if (r.timeout) return { error: 'the checker did not load in time to compile TypeScript' }
    return r.ok ? { code: r.code } : { error: r.error, line: r.line }
  },

  // What an eval did to the types: the errors after that were not there
  // before (by file, code and message: an error that only moved lines is
  // the same error), and how many before are gone. {new, fixed, total} or
  // {skipped}.
  diff(before, after, cap = 8) {
    if (after.skipped) return { skipped: after.skipped }
    if (before.skipped) return { skipped: 'no check from before the eval (' + before.skipped + ')', total: after.diags.length }
    const key = d => d.file + '|' + d.code + '|' + d.message
    const left = new Map()
    for (const d of before.diags) left.set(key(d), (left.get(key(d)) || 0) + 1)
    const added = []
    for (const d of after.diags) {
      const n = left.get(key(d)) || 0
      if (n) left.set(key(d), n - 1)
      else added.push({ file: d.file, line: d.line, message: d.message })
    }
    const fixed = [...left.values()].reduce((a, b) => a + b, 0)
    const out = { new: added.slice(0, cap), fixed, total: after.diags.length }
    if (added.length > cap) out.more = added.length - cap
    return out
  },
}

// A Draft at its head as a view.
export const headView = d => ({ list: () => d.list(), read: p => d.read(p) })
