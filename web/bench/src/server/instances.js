// server/instances.js — the person's instances of the open app, and the watch
// that keeps the page in step with the server.
//
// An instance is a store that runs the app at a ref, with its own data: dev
// (follows draft; the canvas shows it), test (follows draft; seeded with a
// fixture for scenarios) and prop (follows the proposal under review). One
// of each per person and app, made the first time a frame needs it; reset()
// throws one and its data away.
//
// Watch polls, while an app is open, where its refs are (the drafts follow
// them), what the instances run, and the dev instance's new log lines,
// which it hands to onLog (the shell points it at the Console).
//
// Owns: the instances' readiness and the poll timer. Public API: Instances
// (ensure, embed, close, reset, entry), Watch (start, poll, logs, label,
// status, onLog, ev 'status').
import { Slop } from './slop.js';
import { emitter } from '../lib/util.js';

export const Instances = {
  ready: new Map(),     // app|kind → {ref, p: a promise of {id, kind, ref, n, broken}}
  ensure(P, kind, ref) {
    const k = P.app + '|' + kind, cur = this.ready.get(k)
    if (cur && (!ref || cur.ref === ref)) return cur.p
    const p = Slop.call('instance', { app: P.app, kind, ref: kind === 'dev' ? undefined : ref })
    this.ready.set(k, { ref, p })
    p.catch(() => { if (this.ready.get(k) && this.ready.get(k).p === p) this.ready.delete(k) })
    return p
  },
  // a view of the instance for a frame: {src, view, origin, …}
  async embed(P, kind, ref) {
    await this.ensure(P, kind, ref)
    return await Slop.call('embed', { app: P.app, kind })
  },
  // the view of a frame that reloaded or went away (best effort: it expires anyway)
  close(e) { if (e && e.view) Slop.call('close', { view: e.view }).catch(() => { }) },
  async reset(P, kind) {
    const r = await Slop.call('reset', { app: P.app, kind })
    this.ready.delete(P.app + '|' + kind)
    return r
  },
  // the page slop serves with the runtime: app.json's page
  entry(P) {
    try { return JSON.parse(P.read('app.json') || '{}').page || 'index.html' } catch (e) { return 'index.html' }
  }
}

export const Watch = {
  P: null, timer: 0, logT: 0, status: null, ev: emitter(),
  onLog: () => { },   // the shell's: (line) → the Console
  start(P) {
    clearInterval(this.timer)
    this.P = P; this.status = null; this.logT = Date.now() - 60000
    if (!P) return
    this.timer = setInterval(() => this.poll(), 3000)
    this.poll()
  },
  async poll() {
    const P = this.P
    if (!P || document.hidden) return
    try {
      const st = await Slop.call('status', { app: P.app })
      if (this.P !== P) return
      this.status = st
      P.refs = st.refs
      this.ev.emit('status', st)
      const drafts = [P.draft, ...P.openProposals().filter(p => p.draft).map(p => p.draft)]
      await Promise.all(drafts.filter(d => (st.refs[d.ref] ?? 0) !== d.head).map(d => d.refresh()))
      if (st.dev) await this.logs(P)
    } catch (e) { /* the next poll tries again */ }
  },
  // the dev instance's new log lines go to onLog
  async logs(P) {
    const r = await Slop.call('logs', { app: P.app, kind: 'dev' })
    for (const l of r.lines || []) {
      if (l.at <= this.logT) continue
      const level = l.level === 'warn' ? 'warn' : l.level === 'error' ? 'error' : 'log'
      this.onLog({ t: l.at, level, text: l.text, src: '', frame: 'actor', fid: 'actor' })
    }
    for (const l of r.lines || []) this.logT = Math.max(this.logT, l.at)
    return r
  },
  // the header's words for the draft and the dev instance
  label(P) {
    const d = P.draft, dev = this.status && this.status.dev
    const edits = d.pending() ? (d.conflict ? 'conflict' : 'unsaved') : ''
    const devText = !dev ? '' : dev.broken ? 'dev broken' : dev.n === d.head ? 'dev ok' : 'dev on ' + dev.n
    const conflict = d.conflict ? 'your edits to ' + d.conflict.conflicts.join(', ') + ' conflict with draft ' + d.conflict.at : ''
    return { draft: 'draft ' + (d.head ?? '–'), edits, dev: devText, title: (dev && dev.broken) || conflict, bad: !!(dev && dev.broken) || !!d.conflict }
  }
}
addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') Watch.poll() })
