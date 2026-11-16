// model/project.js — an app being developed in the bench: its draft and
// proposals (as Drafts), its threads, its timeline, its canvas.
//
// A workspace is named by its ref: 'draft', or 'proposal/<id>' for a
// proposal the person reviews. Files are read through the workspace's Draft
// (core/draft.js), including the person's uncommitted edits; the person's
// writes go to Draft.edit, an eval's through its own transaction.
// Everything else the bench keeps about the app is the person's own and
// lives in the bench store's SQL, through the bench actor: the project's
// meta (boards, frames, pins, panels, scenario results), threads with their
// messages, timeline events, layout snapshots.
//
// Owns: one app's records in memory and their saving. Does not own: the
// timeline's questions (model/timeline.js), threads' turns (agent/), what is
// shown (ui/). Public API: Project, Projects. Events (P.ev): 'files' (ws,
// paths), 'events' (e), 'threads', 'proposals', 'frames', 'meta'.
import { APP_TEMPLATES } from './templates.js';
import { Drafts, Slop } from '../server/slop.js';
import { Prefs, Records } from '../server/records.js';
import { debounce, emitter, now, uid } from '../lib/util.js';
import { stampEvent } from './timeline.js';

const DEFAULT_META = () => ({ boards: [{ id: 'b1', title: 'Board', frames: [{ id: 'f' + uid(), route: 'index.html', w: 375, h: 720, x: 0, y: 0 }] }], pins: [], panels: [], runs: {} })

export class Project {
  constructor(opened, rec) {
    this.app = opened.app; this.id = opened.app
    this.refs = opened.refs; this.instances = opened.instances
    this.meta = { ...DEFAULT_META(), ...(rec.meta || {}) }
    this.draft = Drafts.for(this.app, 'draft')
    this.proposals = new Map()          // ref → {ref, title, thread, base, status, n, created, closed, draft}
    this.threads = new Map()            // id → thread: {id, title, mode, target, tier, …, msgs (null until loaded)}
    for (const t of rec.threads || []) this.threads.set(t.id, { ...t.meta, id: t.id, created: t.created, updated: t.updated, count: t.count, msgs: null })
    this.events = rec.events || []      // the timeline, oldest first
    this.bySeq = new Map(this.events.map(e => [e.seq, e]))
    this.outbox = []                    // events not yet numbered by the server
    this.ev = emitter()
    this.saveMeta = debounce(() => Records.save('meta|' + this.app, () => Slop.call('saveProject', { app: this.app, meta: this.meta })), 500)
    this.watch(this.draft, 'draft')
  }
  get title() {
    try { return JSON.parse(this.read('app.json') || '{}').title || this.app } catch (e) { return this.app }
  }
  // a Draft's moves and commits, as project events
  watch(d, ws) {
    d.ev.on('head', (n, prev, paths, source) => {
      this.ev.emit('files', ws, paths)
      if (source === 'poll' && prev != null) this.log({ kind: 'outside', who: 'push', ref: d.ref, n, paths: paths.slice(0, 50), note: 'changed outside the bench' })
    })
    d.ev.on('commit', r => { if (r.event) this.addEvent(r.event) })
    d.ev.on('edits', path => this.ev.emit('files', ws, path ? [path] : []))
    d.ev.on('conflict', () => this.ev.emit('files', ws, []))
  }

  // ---- files, in a workspace ----
  draftOf(ws = 'draft') {
    if (ws === 'draft') return this.draft
    const p = this.proposals.get(ws)
    if (!p) throw Object.assign(new Error('no workspace ' + ws + ' (draft, or an open proposal)'), { kind: 'missing' })
    if (!p.draft) { p.draft = Drafts.for(this.app, ws); this.watch(p.draft, ws) }
    return p.draft
  }
  // the person's view: the head, under their uncommitted edits
  view(ws = 'draft') { const d = this.draftOf(ws); return d.edits || d }
  read(path, ws = 'draft') { return this.view(ws).read(path) }
  entry(path, ws = 'draft') { return this.view(ws).entry(path) }
  list(ws = 'draft') { return this.view(ws).list() }
  write(path, text, ws = 'draft') { this.draftOf(ws).edit(path, text) }
  remove(path, ws = 'draft') { this.draftOf(ws).edit(path, null) }

  // ---- proposals: refs the person reviews, accepts onto draft or rejects ----
  openProposals() { return [...this.proposals.values()].filter(p => p.status === 'open') }
  async loadProposals() {
    for (const p of await Slop.call('proposals', { app: this.app })) {
      const cur = this.proposals.get(p.ref)
      this.proposals.set(p.ref, { ...p, draft: cur ? cur.draft : null })
    }
    this.ev.emit('proposals')
  }
  async propose({ title, thread }) {
    const r = await Slop.call('propose', { app: this.app, title, thread })
    this.proposals.set(r.ref, { ...r, created: now(), closed: null, draft: null })
    await this.draftOf(r.ref).open()
    this.ev.emit('proposals')
    return this.proposals.get(r.ref)
  }
  // what a proposal changes: {path, before, after, entry} from its base to
  // its head (with the person's edits in it); texts are null for files kept
  // by hash
  async changes(ref) {
    const p = this.proposals.get(ref), d = this.draftOf(ref)
    if (d.head == null) await d.open()
    await d.load(p.base)
    const view = this.view(ref), base = p.base
    const paths = new Set(d.changed(base, d.head))
    if (d.edits) for (const path of d.edits.changes.keys()) paths.add(path)
    const out = []
    for (const path of [...paths].sort()) {
      const before = d.entry(path, base), after = view.entry(path)
      if (JSON.stringify(before) === JSON.stringify(after)) continue
      out.push({ path, before: before && typeof before.text === 'string' ? before.text : null, after: after && typeof after.text === 'string' ? after.text : null, existed: !!before, entry: after })
    }
    return out
  }
  // Commit a proposal's changes (all, or these paths) onto draft over the
  // proposal's base: the server merges them file by file with what reached
  // draft since. The proposal is then closed; changes not taken go with it.
  async accept(ref, paths, who = 'you') {
    const p = this.proposals.get(ref), d = this.draftOf(ref)
    await d.settle()
    const all = await this.changes(ref), take = paths ? all.filter(c => paths.includes(c.path)) : all
    await this.draft.load(p.base)
    const tx = this.draft.begin({ base: p.base, label: 'accept', event: { who, note: 'accepted "' + p.title + '"' + (take.length < all.length ? ' (' + take.length + ' of ' + all.length + ' files)' : '') } })
    for (const c of take) {
      if (!c.entry) tx.remove(c.path)
      else if (typeof c.entry.text === 'string') tx.write(c.path, c.entry.text)
      else tx.copy(c.path, c.entry)
    }
    const r = await tx.commit()
    if (r.status === 'committed') await this.close(ref, 'accepted')
    return r
  }
  async reject(ref) { await this.close(ref, 'rejected') }
  async close(ref, status) {
    const p = this.proposals.get(ref), d = this.draftOf(ref)
    await Slop.call('closeProposal', { app: this.app, ref, status, ifAt: d.head ?? 0 })
    p.status = status; p.closed = now()
    Drafts.drop(this.app, ref); p.draft = null
    await this.reloadEvents()
    this.ev.emit('proposals')
  }

  // ---- the timeline ----
  // An event from the page (a message, a mark, an eval, …): shown now,
  // numbered by the server when it is saved. Commits are logged by the
  // server itself (addEvent).
  // An event records the snapshot of its ref when it is logged (stampEvent).
  log(e) {
    const ev = { ...stampEvent(e, ref => this.draftOf(ref).head), seq: null, at: now(), who: e.who || 'you' }
    this.events.push(ev); this.outbox.push(ev)
    this.ev.emit('events', ev)
    this.flushEvents()
    return ev
  }
  flushEvents() {
    if (this.sending || !this.outbox.length) return
    const batch = this.outbox.splice(0, 100)
    this.sending = Slop.call('logEvents', { app: this.app, events: batch.map(e => { const o = { ...e }; delete o.seq; delete o.at; return o }) })
      .then(saved => {
        // the server's version is the event; one it had already (an outside
        // change it knew) replaces the page's copy
        saved.forEach((s, i) => {
          const e = batch[i], known = this.bySeq.get(s.seq)
          if (known && known !== e) { this.events.splice(this.events.indexOf(e), 1); return }
          for (const k of Object.keys(e)) if (!(k in s)) delete e[k]
          Object.assign(e, s); this.bySeq.set(s.seq, e)
        })
        this.sortEvents(); this.ev.emit('events', null)
      })
      .catch(e => { Records.error = 'the timeline: ' + (e.message || e); Records.ev.emit('status'); this.outbox.unshift(...batch) })
      .finally(() => { this.sending = null; if (this.outbox.length) setTimeout(() => this.flushEvents(), 1000) })
  }
  addEvent(e) {
    if (this.bySeq.has(e.seq)) return
    this.events.push(e); this.bySeq.set(e.seq, e); this.sortEvents()
    this.ev.emit('events', e)
  }
  sortEvents() { this.events.sort((a, b) => (a.seq ?? Infinity) - (b.seq ?? Infinity)) }
  async reloadEvents() {
    const r = await Slop.call('project', { app: this.app, limit: 2000 })
    for (const e of r.events) this.addEvent(e)
  }
  event(seq) { return this.bySeq.get(seq) || null }
  mark({ label, note, by = 'you', thread, kind }) {
    const mk = kind || (by === 'agent' ? 'milestone' : by === 'ide' ? 'auto' : 'bookmark')
    const e = this.log({ kind: 'mark', mk, who: by, label: String(label || 'Mark').slice(0, 80), note, thread })
    this.ev.emit('marks')
    return e
  }
  marks() { return this.events.filter(e => e.kind === 'mark') }

  // ---- threads: settings and summary in the thread row, messages apart ----
  newThread(title, fields = {}) {
    const t = { id: 'th' + uid(), title: title || 'Thread ' + (this.threads.size + 1), created: now(), mode: 'auto', target: 'proposal', tier: 'default', ...fields, msgs: [] }
    this.threads.set(t.id, t)
    this.saveThread(t)
    this.ev.emit('threads')
    return t
  }
  async loadThread(id) {
    const t = this.threads.get(id)
    if (!t) throw Object.assign(new Error('no thread ' + id), { kind: 'missing' })
    if (t.msgs) return t
    const r = await Slop.call('thread', { id })
    t.msgs = r.messages
    t.saved = t.msgs.map(m => JSON.stringify(m))
    return t
  }
  // Saves the thread's fields and the messages from the first that changed
  // since the last save (a reply grows while a turn runs).
  saveThread(t) {
    if (!t.msgs) return
    Records.save('thread|' + t.id, async () => {
      const cur = t.msgs.map(m => JSON.stringify(m)), was = t.saved || []
      let from = 0
      while (from < cur.length && from < was.length && cur[from] === was[from]) from++
      const meta = { ...t }; for (const k of ['id', 'msgs', 'saved', 'count', 'created', 'updated']) delete meta[k]
      const changed = from < cur.length || cur.length < was.length
      await Slop.call('saveThread', { id: t.id, app: this.app, meta, ...(changed ? { from: from + 1, messages: cur.slice(from).map(m => JSON.parse(m)) } : {}) })
      t.saved = cur
    })
  }
  dropThread(id) {
    this.threads.delete(id)
    Records.save('thread|' + id, () => Slop.call('dropThread', { id }))
    this.ev.emit('threads')
  }

  // ---- the canvas ----
  board() { return this.meta.boards[0] }
  frame(id) { return this.board().frames.find(f => f.id === id) }
  addFrame(f) {
    const b = this.board(), right = b.frames.reduce((m, x) => Math.max(m, x.x + x.w), 0)
    const fr = { id: 'f' + uid(), route: f.route || 'index.html', w: f.w || 375, h: f.h || 720, x: f.x ?? (b.frames.length ? right + 60 : 0), y: f.y ?? 0 }
    b.frames.push(fr)
    this.saveMeta(); this.ev.emit('frames')
    return fr
  }
  removeFrame(id) {
    const b = this.board()
    b.frames = b.frames.filter(f => f.id !== id)
    this.saveMeta(); this.ev.emit('frames')
  }
}

// Opening and making apps; the recently opened ones are a per-viewer
// preference.
export const Projects = {
  recent() { return Prefs.get('recent', []) },
  touch(app) { Prefs.set('recent', [app, ...this.recent().filter(a => a !== app)].slice(0, 12)) },
  async open(app) {
    const [opened, rec] = await Promise.all([Slop.call('open', { app }), Slop.call('project', { app, limit: 2000 })])
    const P = new Project(opened, rec)
    await P.draft.open()
    await P.loadProposals()
    if (!rec.meta) P.saveMeta()
    this.touch(app)
    return P
  },
  // a new app store from a template, on draft
  async create({ id, title, template = 'blank' }) {
    const t = APP_TEMPLATES.find(x => x.id === template) || APP_TEMPLATES[0]
    const files = Object.entries(t.files({ id, title: title || id })).map(([path, text]) => ({ path, text }))
    const r = await Slop.call('create', { id, type: t.type ? t.type(id) : '', files })
    await Slop.refresh()
    return r
  },
  async forget(app) {
    await Slop.call('forget', { app })
    Prefs.set('recent', this.recent().filter(a => a !== app))
  }
}
