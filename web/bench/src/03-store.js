// ---------- store: the artifact db (per viewer, private) or localStorage, behind one queue ----------
const DEL = Symbol('delete')
const Store = {
  mode: 'memory', root: '', db: null, ev: emitter(), status: 'idle', error: '',
  pend: new Map(), inflight: new Map(), flushing: false, timer: 0, mem: new Map(),

  async init() {
    let db = null, user = null, id = null
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        ;[db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')])
        id = user ? await user.id() : null
      }
    } catch (e) { db = null }
    if (db && id) { this.mode = 'db'; this.db = db; this.root = 'data/users/' + id; this.user = user }
    else {
      try { localStorage.setItem('sb1|probe', '1'); localStorage.removeItem('sb1|probe'); this.mode = 'local' } catch { this.mode = 'memory' }
      this.root = 'local'
    }
    addEventListener('pagehide', () => this.flush())
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flush() })
    this.set('idle')
    return this.mode
  },
  set(s, err = '') { this.status = s; this.error = err; this.ev.emit('status', s, err) },
  full(rel) { return this.root + '/' + rel },

  async call(fn) {
    try { return await fn() } catch (e) {
      if (e && e.code === 'unavailable') { await sleep(400 + Math.random() * 600); return await fn() }
      throw e
    }
  },
  shadow(rel) { if (this.pend.has(rel)) return this.pend.get(rel); if (this.inflight.has(rel)) return this.inflight.get(rel); return undefined },
  async get(rel) {
    const sh = this.shadow(rel); if (sh !== undefined) return sh === DEL ? null : clone(sh)
    const p = this.full(rel)
    if (this.mode === 'db') { const s = await this.call(() => this.db.doc(p).get()); return s.exists ? clone(s.data()) : null }
    if (this.mode === 'local') { const v = localStorage.getItem('sb1|' + p); return v ? JSON.parse(v) : null }
    return clone(this.mem.get(p) ?? null)
  },
  async list(relColl) {
    const base = await this.listRaw(relColl), map = new Map(base.map(d => [d.id, d]))
    for (const src of [this.inflight, this.pend]) for (const [rel, data] of src) {
      if (!rel.startsWith(relColl + '/')) continue
      const id = rel.slice(relColl.length + 1); if (id.includes('/')) continue
      data === DEL ? map.delete(id) : map.set(id, { id, data: clone(data) })
    }
    return [...map.values()].sort((a, b) => a.id < b.id ? -1 : 1)
  },
  async listRaw(relColl) {
    const p = this.full(relColl)
    if (this.mode === 'db') { const s = await this.call(() => this.db.collection(p).limit(1000).get()); return s.docs.map(d => ({ id: d.id, data: clone(d.data()) })) }
    const pre = p + '/', out = []
    const keys = this.mode === 'local' ? Object.keys(localStorage).filter(k => k.startsWith('sb1|' + pre)).map(k => k.slice(4)) : [...this.mem.keys()].filter(k => k.startsWith(pre))
    for (const k of keys) {
      const rest = k.slice(pre.length); if (!rest || rest.includes('/')) continue
      out.push({ id: rest, data: this.mode === 'local' ? JSON.parse(localStorage.getItem('sb1|' + k)) : clone(this.mem.get(k)) })
    }
    return out.sort((a, b) => a.id < b.id ? -1 : 1)
  },
  save(rel, data) { this.pend.set(rel, data === DEL ? DEL : clone(data)); this.schedule() },
  remove(rel) { this.save(rel, DEL) },
  schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 700); if (this.status !== 'error') this.set('dirty') },
  async flush() {
    clearTimeout(this.timer)
    if (this.flushing) { this.again = true; return }
    if (!this.pend.size) return
    this.flushing = true; this.set('saving')
    let failed = null
    try {
      while (this.pend.size) {
        const batch = [...this.pend]; this.pend.clear(); for (const [k, v] of batch) this.inflight.set(k, v)
        let i = 0
        const worker = async () => {
          while (i < batch.length) {
            const [rel, data] = batch[i++]
            try { await this.write(rel, data) } catch (e) { failed = e; console.warn('save failed', rel, e) }
            if (this.inflight.get(rel) === data) this.inflight.delete(rel)
          }
        }
        await Promise.all([worker(), worker(), worker(), worker()])
      }
    } finally { this.flushing = false }
    if (failed) {
      const code = failed.code || ''
      const msg = code === 'quota_exceeded' ? 'Storage is full: delete a project or old sessions.' : code === 'invalid_argument' ? 'A save was refused (' + (failed.message || 'too large or not allowed') + ').' : 'Saving failed: ' + (failed.message || failed)
      this.set('error', msg); toast(msg, 5000)
    } else this.set('saved')
    if (this.again) { this.again = false; if (this.pend.size) this.flush() }
  },
  async write(rel, data) {
    const p = this.full(rel)
    if (data !== DEL && JSON.stringify(data).length > 255000) throw Object.assign(new Error('document over 256 KiB: ' + rel), { code: 'invalid_argument' })
    if (this.mode === 'db') return this.call(() => data === DEL ? this.db.doc(p).delete() : this.db.doc(p).set(data))
    if (this.mode === 'local') {
      try { data === DEL ? localStorage.removeItem('sb1|' + p) : localStorage.setItem('sb1|' + p, JSON.stringify(data)) }
      catch (e) { throw Object.assign(new Error('browser storage is full'), { code: 'quota_exceeded' }) }
      return
    }
    data === DEL ? this.mem.delete(p) : this.mem.set(p, clone(data))
  },
  label() {
    const where = this.mode === 'db' ? 'Saved to your account' : this.mode === 'local' ? 'Saved in this browser only' : 'Not saved (no storage here)'
    return { db: 'Account', local: 'Browser', memory: 'Memory' }[this.mode] + ' · ' + ({ idle: 'ready', dirty: 'unsaved', saving: 'saving…', saved: 'saved', error: 'error' }[this.status] || this.status) + '|' + where
  }
}
// file paths become one db segment: letters, digits, _ - . kept; '/' -> '~'; others -> +hhhh
function encKey(path) {
  let s = ''
  for (const ch of path) s += /[A-Za-z0-9_.-]/.test(ch) ? ch : ch === '/' ? '~' : '+' + ch.codePointAt(0).toString(16).padStart(4, '0')
  if (s === '.' || s === '..') s = '+002e' + s.slice(1)
  return s.slice(0, 190)
}
function validPath(path) {
  if (typeof path !== 'string' || !path) return 'path must be a non-empty string'
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(p => !p || p === '.' || p === '..')) return 'paths are relative like "pages/about.html" (no leading /, no . or ..)'
  if (!/^[\w.\-/ @+~]+$/.test(path)) return 'use letters, digits, - _ . / in paths'
  if (path.length > 160) return 'path too long'
  return null
}
