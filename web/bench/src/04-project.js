// ---------- project model: main files, overlay workspaces, tables, session log, marks, threads ----------
class Project {
  constructor(meta) {
    this.id = meta.id; this.meta = meta
    this.files = new Map(); this.overlays = new Map(); this.tables = new Map(); this.threads = new Map()
    this.events = []; this.chunks = []        // chunks: [{id, start, size}]
    // An app project (meta.app, on slop): main's files are the app store's
    // tree at draft. tree: the server's entries {path, sha256, size};
    // synced: each file's text as last pushed; extern: files kept out of
    // the text model (binary, too large), pushed back by hash.
    this.tree = new Map(); this.synced = new Map(); this.extern = new Map(); this.refs = null; this.devStatus = null
    this.ev = emitter()
    this.saveMeta = debounce(() => { this.meta.updated = now(); Store.save(this.key(), this.meta); Projects.touch(this) }, 500)
  }
  key(sub) { return 'p_' + this.id + (sub ? '/' + sub : '') }
  get title() { return this.meta.title }

  // ---- files, through a workspace ('main' or an overlay id) ----
  read(path, ws = 'main') {
    const ov = ws !== 'main' && this.overlays.get(ws)
    if (ov && Object.prototype.hasOwnProperty.call(ov.files, path)) return ov.files[path]
    return this.files.has(path) ? this.files.get(path) : null
  }
  list(ws = 'main') {
    const set = new Set(this.files.keys()), ov = ws !== 'main' && this.overlays.get(ws)
    if (ov) for (const [p, t] of Object.entries(ov.files)) t === null ? set.delete(p) : set.add(p)
    return [...set].sort((a, b) => (a.includes('/') - b.includes('/')) || a.localeCompare(b))
  }
  write(path, text, { ws = 'main', who = 'you', note, thread, via } = {}) {
    const bad = validPath(path); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
    if (typeof text !== 'string') throw Object.assign(new Error('file content must be a string'), { kind: 'invalid' })
    if (text.length > 240000) throw Object.assign(new Error('file too large (max 240 KB)'), { kind: 'invalid' })
    const before = this.read(path, ws)
    if (before === text) return false
    if (ws === 'main') { this.files.set(path, text); if (this.meta.app) Sync.schedule(this); else Store.save(this.key('files/' + encKey(path)), { path, text }) }
    else {
      const ov = this.overlay(ws)
      if (!(path in ov.base)) ov.base[path] = this.files.has(path) ? this.files.get(path) : null
      ov.files[path] = text; ov.updated = now(); this.saveOverlay(ov)
    }
    this.log({ kind: 'write', ws, who, path, after: text, created: before === null, note, thread, ...(via ? { via } : {}) })
    this.ev.emit('files', ws, [path])
    return true
  }
  remove(path, { ws = 'main', who = 'you', note, thread } = {}) {
    if (this.read(path, ws) === null) return false
    if (ws === 'main') { this.files.delete(path); if (this.meta.app) Sync.schedule(this); else Store.remove(this.key('files/' + encKey(path))) }
    else {
      const ov = this.overlay(ws)
      if (!(path in ov.base)) ov.base[path] = this.files.has(path) ? this.files.get(path) : null
      if (ov.base[path] === null) delete ov.files[path]; else ov.files[path] = null
      this.saveOverlay(ov)
    }
    this.log({ kind: 'remove', ws, who, path, note, thread })
    this.ev.emit('files', ws, [path])
    return true
  }

  // put a file back as it was before an eval's first write (the eval failed); logged like any write
  revert(path, ws, snap, { who = 'you', note, thread } = {}) {
    if (ws === 'main') { if (snap.text === null) this.remove(path, { who, note, thread }); else this.write(path, snap.text, { who, note, thread }); return }
    const ov = this.overlays.get(ws); if (!ov) return
    if (snap.inOv) ov.files[path] = snap.ovText; else delete ov.files[path]
    if (!snap.hadBase) delete ov.base[path]
    ov.updated = now(); this.saveOverlay(ov)
    const after = this.read(path, ws)
    this.log(after === null ? { kind: 'remove', ws, who, path, note, thread } : { kind: 'write', ws, who, path, after, note, thread })
    this.ev.emit('files', ws, [path])
  }

  // ---- overlays: a workspace on top of main, reviewed then accepted or rejected ----
  overlay(id) { const ov = this.overlays.get(id); if (!ov) throw Object.assign(new Error('no workspace ' + id), { kind: 'invalid' }); if (ov.status !== 'open') throw Object.assign(new Error('workspace "' + ov.title + '" is ' + ov.status), { kind: 'policy' }); return ov }
  openOverlays() { return [...this.overlays.values()].filter(o => o.status === 'open').sort((a, b) => a.created - b.created) }
  newOverlay({ title, by = 'you', thread } = {}) {
    const n = this.overlays.size + 1
    const ov = { id: 'ov' + uid(), title: title || 'Proposal ' + n, by, thread: thread || null, created: now(), updated: now(), status: 'open', files: {}, base: {} }
    this.overlays.set(ov.id, ov); this.saveOverlay(ov)
    this.log({ kind: 'overlay', ws: ov.id, who: by, note: 'opened "' + ov.title + '"', thread })
    this.ev.emit('overlays')
    return ov
  }
  saveOverlay(ov) { Store.save(this.key('ov/' + ov.id), ov) }
  changes(oid) {
    const ov = this.overlays.get(oid); if (!ov) return []
    return Object.keys(ov.files).sort().map(path => {
      const after = ov.files[path], main = this.files.has(path) ? this.files.get(path) : null, base = path in ov.base ? ov.base[path] : main
      return { path, before: main, after, base, conflict: base !== main, created: main === null && after !== null, deleted: after === null }
    }).filter(c => c.before !== c.after)
  }
  accept(oid, paths, who = 'you', tables) {
    const ov = this.overlay(oid), list = this.changes(oid).filter(c => !paths || paths.includes(c.path))
    for (const c of list) {
      if (c.after === null) this.remove(c.path, { who, note: 'accepted from "' + ov.title + '"' })
      else this.write(c.path, c.after, { who, note: 'accepted from "' + ov.title + '"', via: oid })
      delete ov.files[c.path]; delete ov.base[c.path]
    }
    for (const p of Object.keys(ov.files)) if (ov.files[p] === (this.files.get(p) ?? null)) { delete ov.files[p]; delete ov.base[p] }
    const tch = this.tableChanges(oid).filter(c => tables === undefined ? !paths : tables.includes(c.name))
    for (const c of tch) {
      if (!c.after) { this.tables.delete(c.name); Store.remove(this.key('tables/' + encKey(c.name))); this.log({ kind: 'data', who, ws: 'main', table: c.name, note: 'drop (accepted)' }); this.ev.emit('tables', c.name, 'main') }
      else { const t = clone(c.after); this.tables.set(c.name, t); this.saveTable(t, 'accepted from "' + ov.title + '": +' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length, who, 'main') }
      delete ov.tables[c.name]; if (ov.tbase) delete ov.tbase[c.name]
    }
    if (ov.tables) for (const n of Object.keys(ov.tables)) if (!this.tableChanges(oid).some(c => c.name === n)) { delete ov.tables[n]; if (ov.tbase) delete ov.tbase[n] }
    if (!Object.keys(ov.files).length && !Object.keys(ov.tables || {}).length) ov.status = 'accepted'
    this.saveOverlay(ov)
    this.log({ kind: 'accept', ws: oid, who, note: plural(list.length, 'file') + (tch.length ? ' and ' + plural(tch.length, 'table') : '') + ' from "' + ov.title + '"', paths: list.map(c => c.path) })
    this.ev.emit('overlays'); this.ev.emit('files', oid, list.map(c => c.path))
    return list.length + tch.length
  }
  reject(oid, who = 'you') {
    const ov = this.overlay(oid); ov.status = 'rejected'; this.saveOverlay(ov)
    this.log({ kind: 'reject', ws: oid, who, note: '"' + ov.title + '"' })
    this.ev.emit('overlays'); this.ev.emit('files', oid, Object.keys(ov.files))
  }

  // ---- tables: main's; in a proposal, a copy made on its first write there (so proposals stage data too) ----
  tablesIn(ws = 'main') {
    const m = new Map(this.tables), ov = ws !== 'main' && this.overlays.get(ws)
    if (ov && ov.tables) for (const [n, t] of Object.entries(ov.tables)) t === null ? m.delete(n) : m.set(n, t)
    return m
  }
  table(name, ws = 'main') {
    const t = this.tablesIn(ws).get(name)
    if (!t) throw Object.assign(new Error('no table "' + name + '" (tables: ' + ([...this.tablesIn(ws).keys()].join(', ') || 'none') + ')'), { kind: 'invalid' })
    return t
  }
  ownsTable(name, ws) { const ov = ws !== 'main' && this.overlays.get(ws); return !!ov && !!ov.tables && name in ov.tables }
  tableW(name, ws = 'main', create) {
    if (ws === 'main') {
      let t = this.tables.get(name)
      if (!t && create) { t = { name, cols: [], rows: [], seq: 0 }; this.tables.set(name, t) }
      if (!t) return this.table(name, ws)
      return t
    }
    const ov = this.overlay(ws); ov.tables = ov.tables || {}; ov.tbase = ov.tbase || {}
    if (!(name in ov.tables) || (ov.tables[name] === null && create)) {
      const base = this.tables.get(name)
      if (!base && !create) return this.table(name, ws)
      ov.tables[name] = base ? clone(base) : { name, cols: [], rows: [], seq: 0 }
      if (!(name in ov.tbase)) ov.tbase[name] = base ? hashStr(JSON.stringify(base.rows)) : null
    }
    if (ov.tables[name] === null) return this.table(name, ws)
    return ov.tables[name]
  }
  saveTable(t, op, who, ws = 'main', extra) {
    if (ws === 'main') Store.save(this.key('tables/' + encKey(t.name)), t)
    else { const ov = this.overlays.get(ws); if (ov) { ov.updated = now(); this.saveOverlay(ov) } }
    if (who !== 'site') this.log({ kind: 'data', who, ws, table: t.name, note: op, ...extra })
    this.ev.emit('tables', t.name, ws)
  }
  define(name, cols, who = 'you', ws = 'main') {
    if (!/^[A-Za-z_][\w-]{0,40}$/.test(name)) throw Object.assign(new Error('table names are words: letters, digits, _ or -'), { kind: 'invalid' })
    cols = ['id', ...(cols || []).filter(c => c !== 'id')]
    const t = this.tableW(name, ws, true)
    t.cols = [...new Set([...t.cols.filter(c => cols.includes(c) || t.rows.some(r => r[c] != null)), ...cols])]
    this.saveTable(t, 'define', who, ws); return t.cols
  }
  dropTable(name, who = 'you', ws = 'main') {
    this.table(name, ws)
    if (ws === 'main') { this.tables.delete(name); Store.remove(this.key('tables/' + encKey(name))) }
    else { const ov = this.overlay(ws); ov.tables = ov.tables || {}; ov.tbase = ov.tbase || {}; if (!(name in ov.tbase)) ov.tbase[name] = this.tables.has(name) ? hashStr(JSON.stringify(this.tables.get(name).rows)) : null; ov.tables[name] = null; this.saveOverlay(ov) }
    this.log({ kind: 'data', who, ws, table: name, note: 'drop' }); this.ev.emit('tables', name, ws)
  }
  rows(name, where, ws = 'main') {
    const t = this.table(name, ws)
    return clone(where && typeof where === 'object' ? t.rows.filter(r => Object.entries(where).every(([k, v]) => r[k] === v)) : t.rows)
  }
  insert(name, row, who = 'you', ws = 'main') {
    if (!row || typeof row !== 'object') throw Object.assign(new Error('insert takes an object'), { kind: 'invalid' })
    const t = this.tableW(name, ws)
    t.seq = Math.max(t.seq || 0, ...t.rows.map(r => +r.id || 0)) + 1
    const r = { ...clone(row), id: t.seq }
    for (const k of Object.keys(r)) if (!t.cols.includes(k)) t.cols.push(k)
    t.rows.push(r); this.saveTable(t, 'insert #' + r.id, who, ws); return clone(r)
  }
  update(name, id, patch, who = 'you', ws = 'main') {
    if (!this.table(name, ws).rows.some(x => String(x.id) === String(id))) throw Object.assign(new Error('no row ' + id + ' in ' + name), { kind: 'invalid' })
    const t = this.tableW(name, ws), r = t.rows.find(x => String(x.id) === String(id))
    Object.assign(r, clone(patch), { id: r.id })
    for (const k of Object.keys(r)) if (!t.cols.includes(k)) t.cols.push(k)
    this.saveTable(t, 'update #' + r.id, who, ws); return clone(r)
  }
  removeRow(name, id, who = 'you', ws = 'main') {
    if (!this.table(name, ws).rows.some(x => String(x.id) === String(id))) return false
    const t = this.tableW(name, ws)
    t.rows = t.rows.filter(x => String(x.id) !== String(id))
    this.saveTable(t, 'remove #' + id, who, ws); return true
  }
  // undo for an eval or atomic step: snap is { own, t } as it was before the first write
  restoreTable(name, snap, who = 'you', ws = 'main') {
    if (ws === 'main') {
      if (!snap.t) { if (this.tables.has(name)) { this.tables.delete(name); Store.remove(this.key('tables/' + encKey(name))); this.ev.emit('tables', name, ws) } return }
      const t = clone(snap.t); this.tables.set(name, t); this.saveTable(t, 'rolled back', who, ws); return
    }
    const ov = this.overlays.get(ws); if (!ov) return
    ov.tables = ov.tables || {}
    if (!snap.own) delete ov.tables[name]; else ov.tables[name] = snap.t ? clone(snap.t) : null
    this.saveOverlay(ov); this.ev.emit('tables', name, ws)
  }
  tableSnap(name, ws) { const own = ws === 'main' ? true : this.ownsTable(name, ws), t = this.tablesIn(ws).get(name); return { own, t: t ? clone(t) : null } }
  // what a proposal does to the data: rows added, removed and changed per table
  tableChanges(oid) {
    const ov = this.overlays.get(oid); if (!ov || !ov.tables) return []
    const out = []
    for (const [name, after] of Object.entries(ov.tables)) {
      const before = this.tables.get(name) || null
      if (JSON.stringify(before && { c: before.cols, r: before.rows }) === JSON.stringify(after && { c: after.cols, r: after.rows })) continue
      const bm = new Map((before ? before.rows : []).map(r => [String(r.id), r])), am = new Map((after ? after.rows : []).map(r => [String(r.id), r]))
      const added = [...am.keys()].filter(k => !bm.has(k)), removed = [...bm.keys()].filter(k => !am.has(k)), changed = [...am.keys()].filter(k => bm.has(k) && JSON.stringify(bm.get(k)) !== JSON.stringify(am.get(k)))
      out.push({ name, before, after, added, removed, changed, created: !before, dropped: !after, conflict: (ov.tbase || {})[name] !== undefined && (ov.tbase[name] || null) !== (before ? hashStr(JSON.stringify(before.rows)) : null) })
    }
    return out
  }

  // ---- session log, in chunks of at most ~180 KB ----
  log(e) {
    e.t = now(); e.i = this.events.length
    const last = this.events[this.events.length - 1]
    if (e.kind === 'write' && last && last.kind === 'write' && last.who === e.who && last.who === 'you' && last.path === e.path && last.ws === e.ws && e.t - (last.t2 || last.t) < 20000 && !e.note) {
      last.after = e.after; last.t2 = e.t; this.saveChunk(); this.ev.emit('events'); return last
    }
    let c = this.chunks[this.chunks.length - 1]
    const size = JSON.stringify(e).length
    if (!c || c.size + size > 180000) { c = { id: 'c' + String(this.chunks.length).padStart(4, '0'), start: this.events.length, size: 0 }; this.chunks.push(c) }
    c.size += size; this.events.push(e); this.saveChunk(); this.ev.emit('events', e)
    return e
  }
  saveChunk() {
    const c = this.chunks[this.chunks.length - 1]; if (!c) return
    const next = this.chunks.length > 0 ? this.events.length : 0
    Store.save(this.key('log/' + c.id), { start: c.start, events: this.events.slice(c.start, next) })
  }
  // files of main as they were just after event i (-1: before anything)
  stateAt(i) {
    const st = new Map()
    for (const e of this.events) {
      if (e.i > i) break
      if (e.kind === 'init') { st.clear(); for (const [p, t] of Object.entries(e.files || {})) st.set(p, t) }
      else if (e.ws === 'main' && e.kind === 'write') st.set(e.path, e.after)
      else if (e.ws === 'main' && e.kind === 'remove') st.delete(e.path)
    }
    return st
  }
  // stateAt for the playhead: past states never change (except the last event, which a coalesced edit can update)
  stateAtCached(i) {
    this._st = this._st || new Map()
    if (i < this.events.length - 1 && this._st.has(i)) return this._st.get(i)
    const st = this.stateAt(i); if (i < this.events.length - 1) { this._st.set(i, st); if (this._st.size > 40) this._st.delete(this._st.keys().next().value) }
    return st
  }
  // ---- blame: for each line of a file, the event that wrote it ----
  // the versions a workspace's copy came through: main's; a proposal's starts from main's at its first write
  lineage(path, ws = 'main', upto = Infinity) {
    const all = this.versions(path).filter(v => v.i <= upto)
    if (ws === 'main') return all.filter(v => v.ws === 'main')
    const own = all.filter(v => v.ws === ws), first = own.length ? own[0].i : Infinity
    return [...all.filter(v => v.ws === 'main' && v.i < first), ...own]
  }
  blame(path, ws = 'main', upto = Infinity) {
    let attrib = [], prev = null
    for (const v of this.lineage(path, ws, upto)) {
      if (v.text === null) { attrib = []; prev = null; continue }
      const e = this.events[v.i] || {}
      // a write that accepted a proposal: lines keep the proposal's own authors
      let from = null
      if (e.via) { const pb = this.blame(path, e.via, v.i), pt = this.lineage(path, e.via, v.i).filter(x => x.text !== null).slice(-1)[0]; if (pt && pt.text === v.text) from = pb }
      const next = []
      for (const d of diffLines(prev ?? '', v.text)) {
        if (d.op === ' ') next.push(attrib[d.a - 1] ?? v.i)
        else if (d.op === '+') next.push(from ? from[d.b - 1] ?? v.i : v.i)
      }
      attrib = next; prev = v.text
    }
    return attrib
  }
  // where a change reached main: itself, or the write that accepted its proposal (null if it never did)
  landed(i) {
    const e = this.events[i]; if (!e) return null
    if (e.ws === 'main' || e.kind === 'init') return i
    const a = this.events.find(x => x.i > i && x.via === e.ws && x.path === e.path && x.kind === 'write'); return a ? a.i : null
  }
  // why an event happened: the person's request in that thread, Claude's reply, the marks in between
  why(i) {
    const e = this.events[i]; if (!e) return null
    const out = { i, t: e.t2 || e.t, who: e.who, kind: e.kind, ws: e.ws, note: e.note || e.label || '', thread: e.thread || null, via: e.via || null }
    let th = e.thread && this.threads.get(e.thread)
    if (e.via) { const ov = this.overlays.get(e.via); if (ov) { out.proposal = ov.title; if (!th && ov.thread) th = this.threads.get(ov.thread) } }
    if (th) {
      out.threadTitle = th.title; out.role = th.role || null
      let j = i; while (j >= 0 && !(this.events[j].kind === 'msg' && this.events[j].thread === th.id)) j--
      const msg = j >= 0 ? this.events[j] : null
      // a subagent's work answers its parent's request
      if (!msg && th.parent) { const d = this.events.slice(0, i + 1).reverse().find(x => x.kind === 'delegate' && x.child === th.id); if (d) { out.request = d.note; out.delegatedBy = d.thread } }
      if (msg) out.request = msg.note
      let k = i; while (k < this.events.length && !(this.events[k].kind === 'turn' && this.events[k].thread === th.id)) k++
      const turn = this.events[k]; if (turn) out.reply = (turn.note || '').replace(/^#+\s*/, '')
      const lo = msg ? msg.i : Math.max(0, i - 200), hi = turn ? turn.i : i + 200
      out.marks = this.events.filter(x => x.kind === 'mark' && x.thread === th.id && x.i >= lo && x.i <= hi).map(x => ({ i: x.i, kind: x.mk, label: x.label, why: x.note || undefined }))
    }
    return out
  }
  // what changed in main since event i
  since(i) {
    const then = this.stateAt(i), out = []
    for (const p of new Set([...then.keys(), ...this.files.keys()])) {
      const a = then.has(p) ? then.get(p) : null, b = this.files.has(p) ? this.files.get(p) : null
      if (a !== b) out.push({ path: p, before: a, after: b })
    }
    return out.sort((x, y) => x.path.localeCompare(y.path))
  }
  restore(i, who = 'you') {
    const ch = this.since(i), label = this.events[i] ? (this.events[i].label || this.events[i].note || 'event ' + i) : 'start'
    for (const c of ch) c.before === null ? this.remove(c.path, { who, note: 'restore to ' + label }) : this.write(c.path, c.before, { who, note: 'restore to ' + label })
    return ch.length
  }
  // every saved version of a file: the template/import snapshot, then each write or removal, in any workspace
  versions(path) {
    const out = []
    for (const e of this.events) {
      if (e.kind === 'init' && e.files && Object.prototype.hasOwnProperty.call(e.files, path)) out.push({ i: e.i, t: e.t, who: e.who, kind: 'init', text: e.files[path], note: e.note, ws: 'main' })
      else if (e.path === path && (e.kind === 'write' || e.kind === 'remove')) out.push({ i: e.i, t: e.t2 || e.t, who: e.who, kind: e.kind, text: e.kind === 'remove' ? null : (e.after ?? null), note: e.note, ws: e.ws, thread: e.thread })
    }
    return out
  }
  mark({ label, note, by = 'you', thread, msg, kind }) {
    const mk = kind || (by === 'agent' ? 'milestone' : by === 'ide' ? 'auto' : 'bookmark')
    const e = this.log({ kind: 'mark', mk, ws: 'main', who: by, label: String(label || 'Mark').slice(0, 80), note, thread, msg })
    this.ev.emit('marks'); return e
  }
  marks() { return this.events.filter(e => e.kind === 'mark') }

  // ---- threads ----
  newThread(title) {
    const t = { id: 'th' + uid(), title: title || 'Thread ' + (this.threads.size + 1), created: now(), msgs: [], mode: 'auto', target: 'overlay', tier: 'default' }
    this.threads.set(t.id, t); this.saveThread(t); this.ev.emit('threads'); return t
  }
  saveThread(t) {
    let copy = clone(t)
    while (JSON.stringify(copy).length > 200000 && copy.msgs.some(m => m.steps && m.steps.length)) {
      const m = copy.msgs.find(m => m.steps && m.steps.length); m.steps = m.steps.map(s => ({ ...s, code: trunc(s.code, 300), out: trunc(s.out || '', 200) })); if (m.steps.every(s => s.code.length < 400)) m.steps = []
    }
    Store.save(this.key('threads/' + t.id), copy)
  }
  dropThread(id) { this.threads.delete(id); Store.remove(this.key('threads/' + id)); this.ev.emit('threads') }

  // ---- boards and frames (meta) ----
  board() { return this.meta.boards[0] }
  frame(id) { return this.board().frames.find(f => f.id === id) }
  addFrame(f) {
    const b = this.board(), right = b.frames.reduce((m, x) => Math.max(m, x.x + x.w), 0)
    const fr = { id: 'f' + uid(), route: f.route || 'index.html', w: f.w || 375, h: f.h || 720, x: f.x ?? (b.frames.length ? right + 60 : 0), y: f.y ?? 0 }
    b.frames.push(fr); this.saveMeta(); this.ev.emit('frames'); return fr
  }
  removeFrame(id) { const b = this.board(); b.frames = b.frames.filter(f => f.id !== id); this.saveMeta(); this.ev.emit('frames') }

  export() {
    return { sitebench: 1, title: this.meta.title, template: this.meta.template, created: this.meta.created,
      files: Object.fromEntries(this.files), tables: Object.fromEntries([...this.tables].map(([k, t]) => [k, t])),
      boards: this.meta.boards, pins: this.meta.pins, store: this.meta.store,
      overlays: [...this.overlays.values()], threads: [...this.threads.values()], events: this.events }
  }
}

// ---------- projects: an index of repositories in this artifact ----------
const Projects = {
  index: { projects: [], current: null }, ev: emitter(), cur: null,
  async load() { this.index = (await Store.get('index')) || { projects: [], current: null }; return this.index },
  saveIndex: debounce(function () { Store.save('index', Projects.index) }, 400),
  touch(p) {
    const e = this.index.projects.find(x => x.id === p.id)
    if (e) { e.title = p.meta.title; e.updated = p.meta.updated; e.files = p.files.size; this.saveIndex(); this.ev.emit('index') }
  },
  async create({ template = 'blank', title, data } = {}) {
    const tpl = TEMPLATES.find(t => t.id === template) || TEMPLATES[2]
    const id = uid()
    const src = data || { files: tpl.files, tables: tpl.tables, boards: null }
    const meta = { id, title: title || (data && data.title) || tpl.name, template: data ? (data.template || 'import') : tpl.id, created: now(), updated: now(), boards: null, pins: [], store: {}, v: 1 }
    let x = 0
    meta.boards = src.boards ? clone(src.boards) : [{ id: 'b1', name: 'Board', frames: tpl.frames.map(f => { const fr = { id: 'f' + uid(), route: f.route, w: f.w, h: f.h, x, y: 0 }; x += f.w + 60; return fr }) }]
    if (data) { meta.pins = clone(data.pins || []); meta.store = clone(data.store || {}) }
    const p = new Project(meta)
    for (const [path, text] of Object.entries(src.files || {})) { p.files.set(path, text); Store.save(p.key('files/' + encKey(path)), { path, text }) }
    for (const [name, t] of Object.entries(src.tables || {})) { const tt = { name, cols: [...t.cols], rows: clone(t.rows), seq: Math.max(0, ...t.rows.map(r => +r.id || 0)) }; p.tables.set(name, tt); Store.save(p.key('tables/' + encKey(name)), tt) }
    if (data && data.events && data.events.length) {
      for (const e of data.events) { const c = clone(e); c.i = p.events.length; p.events.push(c) }
      p.chunks = []; let c = null
      p.events.forEach((e, i) => { const s = JSON.stringify(e).length; if (!c || c.size + s > 180000) { c = { id: 'c' + String(p.chunks.length).padStart(4, '0'), start: i, size: 0 }; p.chunks.push(c) } c.size += s })
      p.chunks.forEach((c, k) => Store.save(p.key('log/' + c.id), { start: c.start, events: p.events.slice(c.start, p.chunks[k + 1] ? p.chunks[k + 1].start : p.events.length) }))
      p.log({ kind: 'note', ws: 'main', who: 'you', note: 'imported as "' + meta.title + '"' })
    } else p.log({ kind: 'init', ws: 'main', who: 'you', note: 'new project from ' + (data ? 'import' : tpl.name), files: Object.fromEntries(p.files) })
    for (const ov of (data && data.overlays) || []) { p.overlays.set(ov.id, clone(ov)); p.saveOverlay(ov) }
    for (const th of (data && data.threads) || []) { p.threads.set(th.id, clone(th)); p.saveThread(th) }
    Store.save(p.key(), meta)
    this.index.projects.unshift({ id, title: meta.title, template: meta.template, updated: meta.updated, created: meta.created, files: p.files.size })
    this.saveIndex(); this.ev.emit('index')
    return p
  },
  async open(id) {
    const meta = await Store.get('p_' + id)
    if (meta && meta.app) return this.openApp(meta.app, meta)
    if (!meta && Slop.app(id)) return this.openApp(id, null)
    if (!meta) throw new Error('project not found')
    const p = new Project(meta)
    const [files, ovs, tables, threads, logs] = await Promise.all(['files', 'ov', 'tables', 'threads', 'log'].map(c => Store.list(p.key(c))))
    for (const { data } of files) if (data && typeof data.path === 'string') p.files.set(data.path, data.text || '')
    for (const { data } of ovs) if (data && data.id) p.overlays.set(data.id, data)
    for (const { data } of tables) if (data && data.name) p.tables.set(data.name, data)
    for (const { data } of threads) if (data && data.id) p.threads.set(data.id, data)
    for (const { id: cid, data } of logs.sort((a, b) => a.id < b.id ? -1 : 1)) {
      const start = p.events.length
      for (const e of (data && data.events) || []) { e.i = p.events.length; p.events.push(e) }
      p.chunks.push({ id: cid, start, size: JSON.stringify(data || {}).length })
    }
    meta.boards = meta.boards && meta.boards.length ? meta.boards : [{ id: 'b1', name: 'Board', frames: [] }]
    meta.pins = meta.pins || []; meta.store = meta.store || {}
    return p
  },
  // An app store as a project: files from its draft (made from main the
  // first time), everything else from the bench's documents p_<app>/…,
  // which start empty the first time the app is opened here.
  async openApp(app, meta) {
    const o = await Slop.call('open', { app })
    const fresh = !meta
    meta = meta || { id: app, app, title: app, template: 'app', created: now(), updated: now(), boards: null, pins: [], store: {}, v: 1 }
    meta.id = app; meta.app = app
    const p = new Project(meta)
    p.refs = o.refs || {}; p.devStatus = o.devStatus || null; p.instances = o.instances || []; p.dev = o.dev
    const tree = o.files || []
    p.tree = new Map(tree.map(f => [f.path, f]))
    const { texts } = await Slop.readAll(app, 'draft', tree.filter(textish).map(f => f.path))
    for (const f of tree) {
      if (typeof texts[f.path] === 'string') { p.files.set(f.path, texts[f.path]); p.synced.set(f.path, texts[f.path]) }
      else p.extern.set(f.path, f)
    }
    if (!fresh) {
      const [ovs, tables, threads, logs] = await Promise.all(['ov', 'tables', 'threads', 'log'].map(c => Store.list(p.key(c))))
      for (const { data } of ovs) if (data && data.id) p.overlays.set(data.id, data)
      for (const { data } of tables) if (data && data.name) p.tables.set(data.name, data)
      for (const { data } of threads) if (data && data.id) p.threads.set(data.id, data)
      for (const { id: cid, data } of logs.sort((a, b) => a.id < b.id ? -1 : 1)) {
        const start = p.events.length
        for (const e of (data && data.events) || []) { e.i = p.events.length; p.events.push(e) }
        p.chunks.push({ id: cid, start, size: JSON.stringify(data || {}).length })
      }
    }
    let page = 'index.html'
    try { page = JSON.parse(p.files.get('app.json') || '{}').page || page } catch (e) { /* a broken manifest still opens */ }
    if (!meta.boards || !meta.boards.length) meta.boards = [{ id: 'b1', name: 'Board', frames: [{ id: 'f' + uid(), route: page, w: 1280, h: 800, x: 0, y: 0 }, { id: 'f' + uid(), route: page, w: 375, h: 720, x: 1340, y: 0 }] }]
    meta.pins = meta.pins || []; meta.store = meta.store || {}
    // The timeline starts from the draft as it is; a draft that moved since
    // the bench last saw it (a push from a terminal) is noted.
    const last = p.events.length ? p.stateAt(p.events.length - 1) : null
    if (!last) p.log({ kind: 'init', ws: 'main', who: 'you', note: 'opened app ' + app + ' at draft ' + (p.refs.draft ?? '–'), files: Object.fromEntries(p.files) })
    else if ([...p.files].some(([k, v]) => last.get(k) !== v) || [...last.keys()].some(k => !p.files.has(k))) p.log({ kind: 'init', ws: 'main', who: 'push', note: 'draft ' + (p.refs.draft ?? '–') + ' changed outside the bench', files: Object.fromEntries(p.files) })
    if (fresh) Store.save(p.key(), meta)
    if (!this.index.projects.some(x => x.id === app)) this.index.projects.unshift({ id: app, app, title: meta.title, template: 'app', updated: meta.updated, created: meta.created, files: p.files.size })
    this.saveIndex(); this.ev.emit('index')
    return p
  },
  // A new app store with its first files on draft; the caller opens it.
  async createApp({ id, title, files }) {
    const list = Object.entries(files || slopAppFiles(title || id)).map(([path, text]) => ({ path, text }))
    await Slop.call('create', { id, files: list })
    await Slop.refresh()
    return id
  },
  async remove(id) {
    const key = 'p_' + id
    for (const c of ['files', 'ov', 'tables', 'threads', 'log']) for (const d of await Store.list(key + '/' + c)) Store.remove(key + '/' + c + '/' + d.id)
    Store.remove(key)
    this.index.projects = this.index.projects.filter(p => p.id !== id)
    if (this.index.current === id) this.index.current = null
    this.saveIndex(); this.ev.emit('index')
  }
}
