// agent/sandbox.js — the page's side of the QuickJS sandbox.
//
// Code runs in a worker (src/worker/, built into sandbox.js): QuickJS with
// the host API's names bound to calls that come back here as messages.
// Each call goes through the run's API (core/api.js: checks, guards, run)
// with the eval's context, and its value or error goes back. The worker
// learns the API's names, signatures and long calls from the run; a long
// call (a person, a model, a delegation) pauses the eval's time budget. A
// run that overruns its time with no long call pending gets its worker
// restarted (the engine interrupts itself first; this catches a wedged one).
//
// Owns: the worker and the runs in flight. Public API: Sandbox (run, drop,
// engine, ev 'engine').
import { clamp, emitter } from '../lib/util.js';

export const Sandbox = {
  worker: null, engine: 'off', seq: 0, runs: new Map(), ev: emitter(),
  async spawn() {
    this.engine = 'loading'; this.ev.emit('engine')
    const attach = w => {
      w.onmessage = e => this.onMessage(e.data || {})
      w.onerror = e => { e.preventDefault && e.preventDefault(); if (this.engine === 'loading') { this.engine = 'off'; this.ev.emit('engine') } }
      this.worker = w
    }
    try { attach(new Worker('sandbox.js')) } catch (e1) {
      try { const src = await (await fetch('sandbox.js')).text(); attach(new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))) } catch (e2) { this.engine = 'off'; this.ev.emit('engine'); return }
    }
    setTimeout(() => { if (this.engine === 'loading') { this.engine = 'off'; this.ev.emit('engine') } }, 15000)
  },
  onMessage(m) {
    if (m.type === 'engine') { this.engine = m.engine; this.ev.emit('engine'); return }
    if (m.type === 'call') {
      const run = this.runs.get(m.eid)
      const reply = (ok, v) => this.worker && this.worker.postMessage(ok ? { type: 'reply', id: m.id, ok: true, value: v } : { type: 'reply', id: m.id, ok: false, error: v })
      if (!run) return reply(false, { kind: 'gone', message: 'eval finished' })
      run.calls.push(m.name)
      const e = run.api.entries.get(m.name), long = !!(e && e.long)
      if (long && run.long++ === 0) run.pausedAt = Date.now()
      const done = () => { if (long && --run.long === 0) run.extra += Date.now() - run.pausedAt }
      Promise.resolve().then(() => run.api.call(run.ctx, m.name, m.args || [])).finally(done).then(v => {
        let out = v === undefined ? null : v
        try { out = JSON.parse(JSON.stringify(out)) } catch { out = String(out) }
        reply(true, out)
      }, err => reply(false, { kind: (err && err.kind) || (err instanceof TypeError ? 'invalid' : 'error'), message: String((err && err.message) || err) }))
      return
    }
    if (m.type === 'result') {
      const run = this.runs.get(m.id)
      if (!run) return
      clearInterval(run.timer); this.runs.delete(m.id)
      run.resolve({ ok: m.ok, value: m.value, error: m.error, logs: m.logs || [], engine: m.engine, ms: m.ms, calls: run.calls, scope: m.scope, fresh: m.fresh })
    }
  },
  // Run code with an API (core/api.js) and the eval's context.
  // o: sid (a session: its variables stay between evals), restore (its
  // saved variables), lib ([{name, source}]), roles (names for help()).
  async run(code, { api, ctx, timeoutMs = 20000, sid, restore, lib, roles = [] }) {
    if (!this.worker) await this.spawn()
    if (this.engine === 'loading') await new Promise(r => { const off = this.ev.on('engine', () => { if (this.engine !== 'loading') { off(); r() } }) })
    if (this.engine === 'off') return { ok: false, error: { kind: 'unavailable', message: 'the sandbox worker could not start in this view' }, logs: [] }
    const id = ++this.seq
    return new Promise(resolve => {
      const run = { resolve, api, ctx, calls: [], long: 0, extra: 0, pausedAt: 0 }, t0 = Date.now()
      run.timer = setInterval(() => {
        if (run.long > 0 || Date.now() - t0 - run.extra < timeoutMs + 5000) return
        clearInterval(run.timer); this.runs.delete(id)
        try { this.worker.terminate() } catch { }
        this.worker = null
        for (const [, r] of this.runs) { clearInterval(r.timer); r.resolve({ ok: false, error: { kind: 'timeout', message: 'sandbox restarted' }, logs: [] }) }
        this.runs.clear()
        resolve({ ok: false, error: { kind: 'timeout', message: 'eval exceeded ' + Math.round(timeoutMs / 1000) + ' s; the sandbox was restarted (variables come back from their last saved values)' }, logs: [] })
        this.spawn()
      }, 1000)
      this.runs.set(id, run)
      const sigs = Object.fromEntries([...api.entries].map(([n, e]) => [n, e.sig]))
      this.worker.postMessage({ type: 'eval', id, code, api: api.names(), sigs, long: api.long(), roles, timeoutMs: clamp(timeoutMs, 1000, 120000), sid, restore: restore || null, lib: lib || [] })
    })
  },
  drop(sid) { if (this.worker) this.worker.postMessage({ type: 'drop', sid }) }
}
