// server/records.js — where the bench keeps things: per-viewer preferences in
// localStorage, and saves of the bench's records through its actor.
//
// An app's files are in its app store (core/draft.js). What the bench adds
// around them (the canvas, threads, the timeline, layout snapshots,
// proposals) is in the bench store's SQL, written through the bench actor's
// actions (apps/bench/actor.js); model/ decides what to save, Records
// orders the saves. Only conveniences that may be lost live in the browser.
//
// Owns: the save queues. Public API: Prefs (get, set), Records (save, flush,
// status, ev 'status').
import { emitter } from '../lib/util.js';

export const Prefs = {
  get(key, dflt) { try { const v = localStorage.getItem('bench|' + key); return v == null ? dflt : JSON.parse(v) } catch { return dflt } },
  set(key, v) { try { localStorage.setItem('bench|' + key, JSON.stringify(v)) } catch { } }
}

// Saves of the bench's records, one queue per key: a save waits for the one
// in flight and replaces any that is still waiting (the newest value wins).
// status: 'saved' | 'saving' | 'error' (error: the last failure's message).
export const Records = {
  ev: emitter(), queues: new Map(), error: '',
  get status() { return this.queues.size ? 'saving' : this.error ? 'error' : 'saved' },
  save(key, fn) {
    let q = this.queues.get(key)
    if (!q) { q = { next: null, done: null }; this.queues.set(key, q) }
    q.next = fn
    if (!q.done) q.done = this.pump(key, q)
    this.ev.emit('status')
    return q.done
  },
  async pump(key, q) {
    while (q.next) {
      const fn = q.next; q.next = null
      try { await fn(); this.error = '' } catch (e) { this.error = (e && e.message) || String(e); console.error('saving ' + key, e) }
    }
    this.queues.delete(key); this.ev.emit('status')
  },
  // resolves when every save made so far has finished
  async flush() { while (this.queues.size) await Promise.all([...this.queues.values()].map(q => q.done)) }
}
addEventListener('beforeunload', e => { if (Records.queues.size) { e.preventDefault(); e.returnValue = '' } })
