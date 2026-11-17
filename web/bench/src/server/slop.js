// server/slop.js — the bench's line to the server: its actor's actions, and
// one Draft per app ref.
//
// The bench is a slop app (apps/bench): its page reaches the server only
// through its actor (apps/bench/actor.js), which calls the workshop module
// as the visiting person.
//
// Owns: the actions handle, the list of apps the person may develop, the
// Drafts registry. Public API: Slop (init, call, refresh, app, apps, ev
// 'apps'), Drafts (for, drop), sha256hex.
import { Draft } from '../core/draft.js';
import { emitter } from '../lib/util.js';

export const Slop = {
  actions: null, apps: [], ev: emitter(), error: '',
  async init() {
    const claude = window.claude
    const s = claude && typeof claude.use === 'function' ? await claude.use('slop').catch(() => null) : null
    if (!s || !s.actions) throw new Error('the bench runs on a slop server, as the bench app with its actor (apps/bench)')
    this.actions = s.actions
    await this.refresh().catch(e => { this.error = e.message || String(e) })
  },
  async call(name, args) { return await this.actions[name](args || {}) },
  async refresh() {
    this.apps = (await this.call('apps')) || []
    this.error = ''
    this.ev.emit('apps')
    return this.apps
  },
  app(id) { return this.apps.find(a => a.id === id) || null }
}

// sha256 of a text's UTF-8 bytes, as the server names blobs
export async function sha256hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// One Draft per app ref, shared by everything that shows or changes it.
export const Drafts = {
  map: new Map(),
  for(app, ref = 'draft') {
    const k = app + '|' + ref
    if (!this.map.has(k)) this.map.set(k, new Draft({ app, ref, call: (a, x) => Slop.call(a, x), hash: sha256hex }))
    return this.map.get(k)
  },
  drop(app, ref) { this.map.delete(app + '|' + ref) }
}
