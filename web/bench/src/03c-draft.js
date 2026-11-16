// ---------- draft: an app ref's files as the server has them, and transactions that change them (SLOP3-023) ----------
// The server is the only place an app's files live. A Draft caches what it
// has read, which never goes stale: a snapshot's listing (n → path →
// {sha256, size, type}) never changes, and a text is cached by its hash.
// Every change is a transaction (Tx): a buffer of writes and removals over
// a base snapshot, committed to the ref as one files.commit (an explicit
// change list against that base, merged per file on the server) or folded
// into its parent. A Tx that is dropped leaves nothing behind.
//
//   const tx = draft.begin({ label: 'eval 3' })
//   tx.write('index.html', html); tx.remove('old.js')
//   const r = await tx.commit()   // {status: 'committed', n, at, merged, paths, activated}
//                                 // | {status: 'folded', paths} (a nested Tx)
//                                 // | {status: 'conflict', at, conflicts: [path], paths}
//                                 // | {status: 'failed', code, error, paths}
//
// A Draft talks to the server through call(action, args), the bench actor's
// actions: head {app, ref} → {n}; files {app, at} → [{path, sha256, size,
// type}]; read {app, at, paths} → {texts, binary, more}; commit {app, ref,
// base, changes, message, label} → {n, at, merged, files, activated} or
// {conflict: {at, paths}} (nothing written). hash(text) is the hex sha256 of
// the text's UTF-8 bytes.

const BINARY_EXT = /\.(png|jpe?g|gif|webp|avif|ico|bmp|tiff?|woff2?|ttf|otf|eot|mp[34]|m4a|wav|ogg|webm|mov|zip|gz|tgz|br|zst|pdf|wasm|bin|sqlite|db)$/i
const TEXT_MAX = 240000
// a file kept as text: not a known binary type, not too large to edit
const textish = f => !BINARY_EXT.test(f.path) && f.size <= TEXT_MAX

class Tx {
  constructor(draft, { base, parent = null, label = '', live = false } = {}) {
    this.draft = draft; this.parent = parent; this.label = label
    // live: reads fall through to the draft's head instead of a fixed base
    // (the person's edits: they see the newest files they did not touch)
    this.live = live
    this.base = parent ? parent.base : base
    this.changes = new Map()   // path → {text} | {remove: true}
    this.state = 'open'        // open | committing | committed | folded | aborted
  }
  get open() { return this.state === 'open' }
  must() { if (this.state !== 'open') throw Object.assign(new Error('this transaction is ' + this.state), { kind: 'invalid' }) }
  // what this Tx reads under its own changes: the parent's view, or the snapshot
  under(path) { return this.parent ? this.parent.entry(path) : this.draft.entry(path, this.live ? this.draft.head : this.base) }
  underList() { return this.parent ? this.parent.list() : this.draft.list(this.live ? this.draft.head : this.base) }
  // {text} for a text file, {sha256, size, type} for one kept by hash, null when absent
  entry(path) {
    const c = this.changes.get(path)
    if (c) return c.remove ? null : { text: c.text }
    return this.under(path)
  }
  read(path) { const e = this.entry(path); return e && typeof e.text === 'string' ? e.text : null }
  has(path) { return this.entry(path) !== null }
  list() {
    const set = new Set(this.underList())
    for (const [p, c] of this.changes) c.remove ? set.delete(p) : set.add(p)
    return [...set].sort()
  }
  write(path, text) {
    this.must()
    if (typeof path !== 'string' || !path) throw Object.assign(new Error('path must be a non-empty string'), { kind: 'invalid' })
    if (typeof text !== 'string') throw Object.assign(new Error('text must be a string'), { kind: 'invalid' })
    this.changes.set(path, { text })
  }
  remove(path) { this.must(); this.changes.set(path, { remove: true }) }
  // drop own changes to these paths (all when none given)
  forget(paths) { this.must(); for (const p of paths || [...this.changes.keys()]) this.changes.delete(p) }
  child(o = {}) { this.must(); return new Tx(this.draft, { ...o, parent: this }) }
  paths() { return [...this.changes.keys()].sort() }
  // own changes as {path, before, after} (texts; null for absent or kept by hash)
  diff() {
    return this.paths().map(path => {
      const b = this.under(path), c = this.changes.get(path)
      return { path, before: b && typeof b.text === 'string' ? b.text : null, existed: b !== null, after: c.remove ? null : c.text }
    })
  }
  abort() { if (this.state === 'open') this.state = 'aborted' }
  async commit({ message } = {}) {
    this.must()
    const paths = this.paths()
    if (this.parent) {
      if (!this.parent.open) return { status: 'failed', code: 'aborted', error: 'the transaction this one belongs to has ended (' + this.parent.state + ')', paths }
      for (const [p, c] of this.changes) this.parent.changes.set(p, c)
      this.state = 'folded'
      return { status: 'folded', paths }
    }
    this.state = 'committing'
    let r
    try { r = await this.draft.commitChanges(this.base, this.changes, { message, label: this.label }) } catch (e) { r = { status: 'failed', code: e.code || '', error: e.message || String(e) } }
    r.paths = paths
    this.state = r.status === 'committed' ? 'committed' : 'open'
    return r
  }
}

class Draft {
  constructor({ app, ref = 'draft', call, hash }) {
    this.app = app; this.ref = ref; this.call = call; this.hash = hash
    this.head = null              // the snapshot loaded and shown
    this.listings = new Map()     // n → Map(path → {path, sha256, size, type})
    this.texts = new Map()        // sha256 → text
    this.binary = new Set()       // sha256 of files the server reads as binary
    this.ev = emitter()
    this.queue = Promise.resolve()  // head switches, in order
    this.epoch = 0                // bumped by each commit: a head poll sent before it is stale
    this.edits = null             // the person's uncommitted edits (a live Tx), made on first use
  }

  // ---- reading (synchronous, at a loaded snapshot) ----
  loaded(n) { const l = this.listings.get(n); return !!l && [...l.values()].every(f => !textish(f) || this.texts.has(f.sha256) || this.binary.has(f.sha256)) }
  listing(n = this.head) { return this.listings.get(n) || new Map() }
  // {text} or {sha256, size, type} (kept by hash), or null when absent at n
  entry(path, n = this.head) {
    if (n === 0) return null
    const f = this.listing(n).get(path); if (!f) return null
    const t = this.texts.get(f.sha256)
    return typeof t === 'string' ? { text: t } : { sha256: f.sha256, size: f.size, type: f.type || '' }
  }
  read(path, n = this.head) { const e = this.entry(path, n); return e && typeof e.text === 'string' ? e.text : null }
  list(n = this.head) { return n === 0 ? [] : [...this.listing(n).keys()].sort() }
  // paths that differ between two loaded listings
  changed(a, b) {
    const A = a === 0 ? new Map() : this.listing(a), B = b === 0 ? new Map() : this.listing(b), out = []
    for (const [p, f] of B) { const g = A.get(p); if (!g || g.sha256 !== f.sha256) out.push(p) }
    for (const p of A.keys()) if (!B.has(p)) out.push(p)
    return out.sort()
  }

  // ---- loading ----
  remember(n, files) { if (!this.listings.has(n)) this.listings.set(n, new Map(files.map(f => [f.path, { path: f.path, sha256: f.sha256, size: f.size, type: f.type || '' }]))) }
  async load(n) {
    if (n === 0 || this.loaded(n)) return
    if (!this.listings.has(n)) this.remember(n, await this.call('files', { app: this.app, at: n }))
    let want = [...this.listing(n).values()].filter(f => textish(f) && !this.texts.has(f.sha256) && !this.binary.has(f.sha256))
    while (want.length) {
      const r = await this.call('read', { app: this.app, at: n, paths: want.map(f => f.path) })
      const byPath = new Map(want.map(f => [f.path, f]))
      for (const [p, t] of Object.entries(r.texts || {})) { const f = byPath.get(p); if (f) this.texts.set(f.sha256, t) }
      for (const p of r.binary || []) { const f = byPath.get(p); if (f) this.binary.add(f.sha256) }
      const more = (r.more || []).map(p => byPath.get(p)).filter(Boolean)
      if (!more.length || more.length === want.length) break
      want = more
    }
  }
  // a file's text at snapshot n, loading it if needed
  async textAt(n, path) { await this.load(n); return this.read(path, n) }

  // Switch the shown head to n once it is loaded, in order with other
  // switches; emits 'head' (n, prev, paths that differ).
  moveHead(n) {
    return (this.queue = this.queue.then(async () => {
      if (n === this.head) return
      await this.load(n)
      const prev = this.head; this.head = n
      const paths = prev == null ? this.list(n) : this.changed(prev, n)
      if (this.edits) this.rebaseEdits()
      this.ev.emit('head', n, prev, paths)
    }).catch(e => { this.ev.emit('error', e) }))
  }
  async open() {
    const r = await this.call('head', { app: this.app, ref: this.ref })
    await this.moveHead(r.n ?? 0)
    return this.head
  }
  // Ask where the ref is; follow it when it moved (someone else committed,
  // a push from a terminal, a rollback). A poll sent before one of this
  // Draft's commits finished is stale and ignored.
  async refresh() {
    const epoch = this.epoch
    const r = await this.call('head', { app: this.app, ref: this.ref })
    if (epoch === this.epoch && (r.n ?? 0) !== this.head) await this.moveHead(r.n ?? 0)
    return this.head
  }

  // ---- writing ----
  begin(o = {}) { return new Tx(this, { base: this.head, ...o }) }
  async commitChanges(base, changes, { message, label } = {}) {
    if (!changes.size) return { status: 'committed', n: base, at: base, merged: false, activated: [] }
    const wire = [...changes].map(([path, c]) => c.remove ? { path, remove: true } : { path, text: c.text })
    let r
    try {
      r = await this.call('commit', { app: this.app, ref: this.ref, base, changes: wire, message: message || label || 'bench', label: label || '' })
    } catch (e) {
      return { status: 'failed', code: (e && e.code) || '', error: (e && e.message) || String(e) }
    }
    if (r.conflict) return { status: 'conflict', at: r.conflict.at, conflicts: r.conflict.paths }
    this.epoch++
    // the texts just sent are cached by hash, so loading n reads only what others changed
    for (const c of changes.values()) if (!c.remove) this.texts.set(await this.hash(c.text), c.text)
    if (r.files) this.remember(r.n, r.files)
    // a later commit may already have moved the head past n
    if (this.head == null || r.n > this.head) await this.moveHead(r.n)
    return { status: 'committed', n: r.n, at: r.at, merged: !!r.merged, activated: r.activated || [] }
  }

  // ---- the person's edits: one live Tx, committed after a pause ----
  // edit(path, text | null): buffered; commits EDIT_PAUSE ms after the last
  // edit. settle() commits now. A conflict keeps the edits buffered and
  // emits 'conflict' {conflicts}: keepMine() or takeTheirs() resolves it.
  edit(path, text) {
    if (!this.edits) this.edits = this.begin({ live: true, label: 'you' })
    text === null ? this.edits.remove(path) : this.edits.write(path, text)
    this.ev.emit('edits', path)
    clearTimeout(this.editT); this.editT = setTimeout(() => { this.settle().catch(() => { }) }, Draft.EDIT_PAUSE)
  }
  pending() { return !!this.edits && this.edits.changes.size > 0 }
  // The edits' base follows the head while no edited path changed in
  // between; otherwise it stays, and the commit reports those paths.
  rebaseEdits() {
    const tx = this.edits
    if (!tx || tx.base === this.head) return
    if (!tx.changes.size || this.changed(tx.base, this.head).every(p => !tx.changes.has(p))) tx.base = this.head
  }
  // Keep one's own text over a conflicting change: the base moves to the
  // head, so the next commit replaces what is there.
  keepMine() { if (this.edits) { this.edits.base = this.head; return this.settle() } }
  // Take the server's version of these paths: the edits to them are dropped.
  takeTheirs(paths) { if (this.edits) { this.edits.forget(paths); this.rebaseEdits(); this.ev.emit('edits', null) } }
  settle() {
    clearTimeout(this.editT)
    return (this.settling = (this.settling || Promise.resolve()).then(async () => {
      const tx = this.edits
      if (!tx || !tx.changes.size) return { status: 'committed', n: this.head, paths: [] }
      // what is sent; edits made while it is in flight stay buffered, on top
      const sent = new Map(tx.changes), base = tx.base, paths = [...sent.keys()].sort()
      const r = await this.commitChanges(base, sent, { message: 'edited ' + paths.slice(0, 3).join(', ') + (paths.length > 3 ? ', …' : ''), label: 'you' })
      r.paths = paths
      if (r.status === 'committed') {
        for (const [p, c] of sent) if (tx.changes.get(p) === c) tx.changes.delete(p)
        // the rest was typed over a view that had the sent edits, now at n;
        // it moves there unless someone else changed one of its paths too
        const others = this.changed(base, r.n).filter(p => !sent.has(p))
        if (others.every(p => !tx.changes.has(p))) tx.base = r.n
        this.rebaseEdits()
      } else this.ev.emit(r.status === 'conflict' ? 'conflict' : 'error', r)
      this.ev.emit('edits', null)
      return r
    }))
  }
}
Draft.EDIT_PAUSE = 400
