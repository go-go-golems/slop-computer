// ui/app.js — the shell: the open app, the workspace and mode, the
// selection, the header and its menus, and the wiring between the layers.
//
// The shell is the only module that knows the page as a whole. It hands the
// layers below what only the page can do: FrameHost.ui (frames/host.js),
// AgentUI (agent/eval.js), Watch.onLog (server/instances.js); and it adds
// the panel calls to the host API. Views (ui/*.js) read App for the open
// project and listen to App.ev:
//   'project' (P), 'ws' (ws), 'files' (ws, paths), 'sel' (info), 'log' (l),
//   'events', 'threads', 'proposals', 'pins', 'health', 'frameready' (fh),
//   'trace', 'version', 'panels', 'panelvalue', 'preview', 'ask', 'scenarios'.
//
// Owns: the open project and the page's state around it. Public API: App.
import { $, clear, confirmBox, h, modal, popMenu, promptBox, put, toast } from '../lib/dom.js';
import { APP_TEMPLATES } from '../model/templates.js';
import { Agent } from '../agent/agent.js';
import { AgentUI } from '../agent/eval.js';
import { Dock, LAYOUTS, Views, normalize, walkTiles } from './dock.js';
import { FrameHost, FrameHosts, Headless } from '../frames/host.js';
import { Instances, Watch } from '../server/instances.js';
import { Prefs, Records } from '../server/records.js';
import { Preview } from './panels.js';
import { Projects } from '../model/project.js';
import { Publish } from '../server/publish.js';
import { Sandbox } from '../agent/sandbox.js';
import { Slop } from '../server/slop.js';
import { Snaps } from '../frames/layout.js';
import { Types, headView } from '../agent/types.js';
import { appZip, readArchive, saveFile, slug } from './archive.js';
import { clone, debounce, emitter, lineOf, now, offsetOfLine, plural } from '../lib/util.js';

export const App = {
  P: null, ws: 'draft', mode: 'select', sel: null, logs: [], ev: emitter(), prefs: {}, canvas: null, offs: [], traceTarget: null,
  // set by views when they are made: what other views may ask of them
  code: null, docs: null, agentView: null, timeline: null,

  // ---- queries ----
  health() {
    let n = 0
    for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) n += fh.issues.length + fh.errors
    if (Watch.status && Watch.status.dev && Watch.status.dev.broken) n++
    return n
  },
  hostFor(fid) { return this.canvas ? this.canvas.hostFor(fid) : null },
  hostByFid(fid) { for (const fh of FrameHosts) if (fh.fid === fid) return fh; return null },
  firstHost() { for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) return fh; return null },
  pinsFor(route) { return this.P ? (this.P.meta.pins || []).filter(p => p.route === route) : [] },
  proposal(ws = this.ws) { return this.P && ws !== 'draft' ? this.P.proposals.get(ws) || null : null },

  // ---- selection, pins, text edits ----
  // outline, in every frame, the elements a source line or CSS rule renders; resolves to how many, in how many frames
  async trace(target) {
    this.traceTarget = target || null
    let elements = 0, frames = 0
    await Promise.all([...FrameHosts].filter(fh => !fh.headless && fh.project === this.P && fh.ready).map(async fh => {
      try { const r = await fh.call('trace', [target || null], 1500); if (r && r.count) { elements += r.count; frames++ } } catch { }
    }))
    return target ? { elements, frames, selector: target.selector || null } : null
  },
  select(info) {
    if (this.traceTarget) this.trace(null)
    this.sel = info; this.ev.emit('sel', info)
    if (this.canvas) this.canvas.paintAll()
    if (!Dock.visible('inspector') && !Dock.visible('code')) Dock.open('inspector')
  },
  placePin(host, m) { if (this.canvas) this.canvas.newPin(host, m) },
  openPin(id, host) { if (this.canvas) this.canvas.showPin(id, host) },
  // the person edited a text on the canvas: find it near its source line and replace it
  textEdit(host, m) {
    const [file, line] = (m.src || '').split(':'), P = this.P, text = P.read(file, host.ws)
    if (text == null) return
    const off = offsetOfLine(text, +line), old = m.old.trim(), next = m.text.trim()
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    for (const cand of [old, esc(old), old.replace(/&/g, '&amp;')]) {
      const i = text.indexOf(cand, off)
      if (i >= 0 && i - off < 4000) { P.write(file, text.slice(0, i) + esc(next) + text.slice(i + cand.length), host.ws); toast('Text updated in ' + file + ':' + lineOf(text, i)); return }
    }
    toast('Could not find that text in ' + file + ' (it may come from a script). Edit it in Code.')
    host.load()
  },
  consoleAdd(l) { this.logs.push(l); if (this.logs.length > 1000) this.logs.splice(0, 200); this.ev.emit('log', l) },
  askAgent(text) { Dock.open('agent'); setTimeout(() => this.agentView && this.agentView.compose(text), 30) },
  showThread(tid) { Dock.open('agent'); if (this.agentView && this.P.threads.get(tid)) this.agentView.open(tid) },
  viewVersion(path, seq) { Dock.open('code'); setTimeout(() => this.code && this.code.showVersion(path, seq), 20) },
  openDoc(path) { Dock.open('docs'); setTimeout(() => this.docs && this.docs.open(path), 20) },
  reveal(file, line) {
    if (this.ws !== 'draft' && this.P.read(file, this.ws) === null && this.P.read(file, 'draft') !== null) this.setWs('draft')
    Dock.open('code'); setTimeout(() => this.code && this.code.open(file, line), 20)
  },
  compare(on) { if (this.canvas) { this.canvas.compare = on && this.ws !== 'draft'; this.canvas.sync() } this.paintHeader() },
  async addMark() {
    if (!this.P) return
    const label = await promptBox('Add a mark', 'A label for this point in the session', 'Checkpoint ' + (this.P.marks().length + 1))
    if (label) { this.P.mark({ label, by: 'you', ref: this.ws }); toast('Marked') }
  },

  // ---- workspace and mode ----
  setWs(ws) {
    if (ws !== 'draft' && (!this.proposal(ws) || this.proposal(ws).status !== 'open')) ws = 'draft'
    this.ws = ws
    if (ws === 'draft' && this.canvas) this.canvas.compare = false
    this.ev.emit('ws', ws)
    if (this.canvas) this.canvas.sync()
    this.paintHeader()
  },
  async newProposal() {
    const t = await promptBox('New proposal', 'A copy of draft you edit and then accept onto it (or reject)', 'My change ' + (this.P.proposals.size + 1))
    if (!t) return
    try { const p = await this.P.propose({ title: t }); this.setWs(p.ref) } catch (e) { toast('Could not make a proposal: ' + (e.message || e), 5000) }
  },
  setMode(m) {
    this.mode = m
    for (const fh of FrameHosts) if (!fh.headless) fh.push({ push: 'mode', mode: m })
    if (this.canvas) this.canvas.paintAll()
    this.paintHeader(); this.savePrefs()
  },

  // ---- preferences (this viewer's) ----
  savePrefs: debounce(function () { Prefs.set('prefs', { theme: App.prefs.theme || 'auto', layout: Dock.layout, floats: Dock.floats, layouts: App.prefs.layouts || {}, mode: App.mode }) }, 800),
  theme(t) {
    this.prefs.theme = t
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t
    this.savePrefs()
  },

  // ---- opening an app ----
  async openProject(app) {
    let P
    try { P = await Projects.open(app) } catch (e) { toast('Could not open ' + app + ': ' + (e.message || e), 5000); return false }
    if (this.P) await this.P.draft.settle().catch(() => { })
    this.offs.forEach(f => f()); this.offs = []
    if (this.canvas) this.canvas.reset()
    Headless.clear()
    this.P = P; this.ws = 'draft'; this.sel = null; this.logs = []
    this.offs.push(
      P.ev.on('files', (ws, paths) => { this.ev.emit('files', ws, paths); this.paintHeader() }),
      P.ev.on('proposals', () => {
        if (this.ws !== 'draft' && (this.proposal() || {}).status !== 'open') this.setWs('draft')
        Headless.prune(P, ref => (P.proposals.get(ref) || {}).status === 'open')
        this.ev.emit('proposals'); this.paintHeader(); if (this.canvas) this.canvas.sync()
      }),
      P.ev.on('frames', () => { if (this.canvas) this.canvas.sync() }),
      P.ev.on('events', e => this.ev.emit('events', e)),
      P.ev.on('marks', () => this.ev.emit('events')),
      P.ev.on('threads', () => this.ev.emit('threads')),
      P.ev.on('pins', () => this.ev.emit('pins')),
      this.ev.on('pins', () => { for (const fh of FrameHosts) if (!fh.headless && fh.project === P) fh.push({ push: 'pins', pins: this.pinsFor(fh.route) }) }),
      this.ev.on('health', () => { this.paintHeader(); Dock.refreshTabs() }),
      ...this.autoMarks(P))
    Watch.start(P)
    Snaps.open(P).catch(() => { })
    // an app with TypeScript: warm the checker now (its first check parses
    // the DOM's types, about a second), so the first eval's check is quick
    const head = headView(P.draftOf('draft'))
    if (Types.wants(head)) Types.check(P, head, { timeoutMs: 30000 }).catch(() => { })
    this.ev.emit('project', P)
    if (this.canvas) this.canvas.sync()
    this.paintHeader()
    return true
  },
  // marks the bench adds by itself: every check passing again, the first error
  autoMarks(P) {
    const t0 = now(); let prev = null, errState = false
    const settled = () => now() - t0 > 4000 && this.P === P
    const hosts = () => [...FrameHosts].filter(fh => !fh.headless && fh.project === P)
    const check = debounce(() => {
      if (hosts().some(fh => fh.loading)) return check()
      const n = this.health(), errs = hosts().reduce((s, fh) => s + fh.errors, 0)
      if (settled() && prev > 0 && n === 0) P.mark({ label: 'All checks pass', by: 'ide', kind: 'auto' })
      if (!errs) errState = false
      prev = n
    }, 1200)
    return [this.ev.on('health', check), this.ev.on('log', l => {
      if (l.level !== 'error' || errState || !settled()) return
      errState = true
      P.mark({ label: 'First error: ' + l.text.slice(0, 60), note: l.frame + (l.src ? ' @' + l.src : ''), by: 'ide', kind: 'auto' })
    })]
  },

  // ---- apps: new, import, forget, download ----
  newAppDialog(files) {
    let pick = APP_TEMPLATES[0].id
    const id = h('input.txt', { value: '', placeholder: 'id: lowercase letters, digits and -', style: { width: '100%' } })
    const title = h('input.txt', { value: '', placeholder: 'Title (optional)', style: { width: '100%' } })
    const cards = h('div.tcards')
    const paint = () => { clear(cards); for (const t of APP_TEMPLATES) cards.appendChild(h('button' + (t.id === pick ? '.on' : ''), { on: { click: () => { pick = t.id; paint() } } }, h('b', t.name), h('small', t.blurb))) }
    const go = async () => {
      const v = id.value.trim()
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v)) { toast('The id is a store id: lowercase letters, digits and -, at most 63'); return false }
      try {
        if (files) { await Slop.call('create', { id: v, type: '', files }); await Slop.refresh() } else await Projects.create({ id: v, title: title.value.trim() || v, template: pick })
        await this.openProject(v)
        toast('New app ' + v + ' (on draft; publish to make it visible)')
      } catch (e) { toast('Could not create ' + v + ': ' + (e.message || e), 5000); return false }
    }
    if (!files) paint()
    modal({
      title: files ? 'Import as a new app' : 'New app',
      body: [h('p.note', files ? plural(files.length, 'file') + ' go to the new app\'s draft.' : 'An app store with app.json and a page. Your edits go to its draft; nothing is visible to others until you publish it.'), files ? null : cards, id, files ? null : title],
      actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, run: go }]
    })
    setTimeout(() => id.focus(), 0)
  },
  async forget() {
    const P = this.P
    if (!await confirmBox('Forget ' + P.app + ' here?', 'The bench forgets its threads, timeline, boards and snapshots for this app. The app store, its files, refs and instances stay as they are.', 'Forget')) return
    await Projects.forget(P.app)
    const next = Projects.recent()[0] || (Slop.apps[0] || {}).id
    if (next) await this.openProject(next)
    toast('Forgot ' + P.app)
  },
  async downloadProject() {
    toast('Packing ' + this.P.app + '…')
    try { await saveFile(slug(this.P.app) + '.bench.zip', await appZip(this.P)) } catch (e) { toast('Could not build the zip: ' + e.message) }
  },
  async importFile(file) {
    try {
      const files = await readArchive(await file.arrayBuffer(), file.name || 'import')
      this.newAppDialog(files)
      return true
    } catch (e) { toast('Import failed: ' + e.message, 5000); return false }
  },
  importDialog() {
    const input = h('input', { type: 'file', accept: '.zip,application/zip', style: { display: 'none' }, on: { change: async () => { if (input.files[0] && await this.importFile(input.files[0])) m.close() } } })
    const drop = h('div', { style: { border: '1px dashed var(--ink-2)', padding: '28px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' } },
      h('b', 'Drop a .zip here'), h('span.note', 'A bench download, or any zip of an app\'s files: its text files become a new app\'s draft.'),
      h('button.btn', { on: { click: () => input.click() } }, 'Choose a file…'), input)
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)' })
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '' })
    drop.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f && await this.importFile(f)) m.close() })
    const m = modal({ title: 'Import an app', body: [drop], actions: [{ label: 'Close' }] })
  },
  // dropping a zip anywhere on the workbench imports it
  dropImport() {
    let depth = 0
    const hint = h('div.drop-hint', { hidden: true, style: { inset: '8px' } }, h('span', 'Drop to import as a new app'))
    document.body.appendChild(hint)
    const files = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    addEventListener('dragenter', e => { if (!files(e) || $('.modal')) return; depth++; hint.hidden = false; document.body.classList.add('moving') })
    addEventListener('dragleave', e => { if (!files(e)) return; if (--depth <= 0) { depth = 0; hint.hidden = true; document.body.classList.remove('moving') } })
    addEventListener('dragover', e => { if (files(e)) e.preventDefault() })
    addEventListener('drop', e => {
      if (!files(e)) return
      e.preventDefault(); depth = 0; hint.hidden = true; document.body.classList.remove('moving')
      if ($('.modal')) return
      const f = e.dataTransfer.files[0]
      if (f && /\.zip$/i.test(f.name)) this.importFile(f); else if (f) toast('Drop a .zip of an app')
    })
  },

  // ---- publishing ----
  async publishDialog() {
    const P = this.P
    let pf
    try { pf = await Publish.preflight(P) } catch (e) { toast('Could not check ' + P.app + ': ' + (e.message || e), 5000); return }
    const nothing = pf.refs.draft === pf.refs.main, blocked = pf.blockers.length > 0
    const lines = Publish.lines(pf).map(l => h('div', { style: { margin: '2px 0', color: /^BLOCKED/.test(l) ? 'var(--bad, #c00)' : '' } }, l))
    modal({
      title: 'Publish ' + P.app, wide: true,
      body: [h('p.note', 'Publishing moves main to this draft. Production instances run it on their next view; a migration runs on each. You can roll back.'), h('div.mono', { style: { fontSize: '12px' } }, lines)],
      actions: [{ label: 'Cancel' }, ...(nothing || blocked ? [] : [{
        label: 'Publish draft ' + pf.refs.draft, primary: true, run: async () => {
          try { const r = await Publish.run(P, pf); toast('Published draft ' + r.n + ' to main'); this.rolloutDialog(r.n, r.from) } catch (e) { toast('Not published: ' + (e.message || e), 6000) }
        }
      }])]
    })
  },
  async rolloutDialog(n, from) {
    const P = this.P
    let pf
    try { pf = await Slop.call('preflight', { app: P.app }) } catch (e) { return }
    const list = h('div.mono', { style: { fontSize: '12px' } })
    const paint = rows => {
      clear(list)
      for (const x of rows) {
        list.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '3px 0' } },
          h('span', { style: { flex: 1 } }, x.store + ' @' + x.n + (x.broken ? ' · broken: ' + x.broken.slice(0, 80) : x.n === n ? ' · on ' + n : ' · activates on its next view')),
          x.n === n ? null : h('button.btn.sm', { on: { click: async () => { try { Object.assign(x, await Slop.call('activate', { store: x.store })); paint(rows) } catch (e) { toast(e.message || String(e)) } } } }, 'Activate now')))
      }
    }
    paint(pf.production)
    if (!pf.production.length) list.append(h('div', 'No production instance follows main yet. Mount the app or make an instance (slop store new <id> --app ' + P.app + ').'))
    modal({
      title: 'Published draft ' + n, wide: true, body: [h('p.note', 'Instances that follow main:'), list],
      actions: [{ label: from ? 'Roll back to ' + from : 'Close', danger: !!from, run: async () => { if (!from) return; try { await Publish.rollback(P, from, n); toast('main is back at ' + from) } catch (e) { toast('Not rolled back: ' + (e.message || e), 6000) } } }, ...(from ? [{ label: 'Done', primary: true }] : [])]
    })
  },
  async resetDev() {
    const P = this.P
    if (!await confirmBox('Reset dev data?', 'Your dev instance of ' + P.app + ' and its data are dropped, and a fresh one runs draft. The app and its other instances are not touched.', 'Reset')) return
    try { await Instances.reset(P, 'dev') } catch (e) { toast('Could not reset: ' + (e.message || e), 5000); return }
    for (const fh of FrameHosts) if (fh.project === P && fh.kind === 'dev') fh.load({ keepState: false })
    toast('A fresh dev instance of ' + P.app)
  },

  // ---- header ----
  header() {
    this.hdr = {
      proj: h('button.projbtn', { on: { click: e => this.projectMenu(e.currentTarget) } }),
      ws: h('button.wsbtn', { title: 'Workspace: draft, or a proposal on top of it', on: { click: e => this.wsMenu(e.currentTarget) } }),
      modes: h('div.seg.modes', [['select', 'Select', 'V'], ['play', 'Play', 'P'], ['comment', 'Comment', 'C']].map(([m, l, k]) => h('button', { 'data-m': m, title: l + ' (' + k + ')', on: { click: () => this.setMode(m) } }, l))),
      health: h('button.pill', { title: 'Layout, contrast and a11y checks, plus page errors', on: { click: e => this.healthMenu(e.currentTarget) } }),
      agent: h('button.pill.hide-s', { title: 'Claude', on: { click: () => Dock.open('agent') } }),
      store: h('button.pill.hide-s', { on: { click: () => { if (this.P) this.P.draft.settle(); Watch.poll() } } }),
      publish: h('button.btn.primary', { title: 'Publish draft to main: what people use', on: { click: () => this.publishDialog() } }, 'Publish')
    }
    const H = this.hdr
    return h('header.bar', h('div.brand', 'Bench', h('i', 'slop app workbench')),
      h('div.rel', H.proj), h('div.rel', H.ws), H.modes, h('span.sp'),
      h('div.rel', H.health), H.agent, H.store, H.publish,
      h('button.btn.hide-s', { title: 'Bookmark this moment on the timeline', on: { click: () => this.addMark() } }, '+ Mark'),
      h('div.rel', h('button.btn', { on: { click: e => this.layoutMenu(e.currentTarget) } }, 'Layout')),
      h('button.ibtn', { title: 'Theme', on: { click: () => this.theme({ auto: 'dark', dark: 'light', light: 'auto' }[this.prefs.theme || 'auto']) } }, '◐'))
  },
  paintHeader() {
    const H = this.hdr
    if (!H || !this.P) return
    const P = this.P, prop = this.proposal()
    clear(H.proj).append(h('span.ptitle', P.title), h('span.pcode', P.app), h('span.caret', '▾'))
    put(clear(H.ws), h('span.dot' + (prop ? '.busy' : '.ok')), prop ? 'Proposal: ' + (prop.title.length > 24 ? prop.title.slice(0, 24) + '…' : prop.title) : 'draft', h('span.caret', '▾'))
    for (const b of H.modes.children) b.classList.toggle('on', b.dataset.m === this.mode)
    const n = this.health()
    H.health.className = 'pill' + (n ? ' bad' : ''); clear(H.health).append(h('b', String(n)), h('span', n === 1 ? 'issue' : 'issues'))
    const busy = Agent.anyBusy()
    H.agent.className = 'pill hide-s' + (busy ? ' busy' : ''); clear(H.agent).append(h('b', busy ? 'Working' : Agent.sample ? 'Idle' : Agent.ready ? 'Off' : '…'), h('span', 'Claude'))
    // where draft is, the person's edits, the dev instance on it
    const l = Watch.label(P), saving = Records.status
    H.store.title = 'App store ' + P.app + ': your edits commit to its draft' + (l.title ? ' · ' + l.title : '') + (saving === 'error' ? ' · saving failed: ' + Records.error : '') + ' (click to commit now)'
    H.store.className = 'pill hide-s' + (l.bad || saving === 'error' ? ' bad' : '')
    clear(H.store).append(h('b', l.edits || l.draft), h('span', l.dev || 'no dev instance'))
  },
  projectMenu(btn) {
    const recent = Projects.recent(), items = [{ group: 'Recent' }]
    for (const id of recent) { const a = Slop.app(id); items.push({ label: id, sub: a ? [a.refs.draft != null ? 'draft ' + a.refs.draft : '', a.refs.main != null ? 'main ' + a.refs.main : 'not published'].filter(Boolean).join(' · ') : '', on: this.P && id === this.P.app, run: () => { if (!this.P || id !== this.P.app) this.openProject(id) } }) }
    items.push({ group: 'Apps on this server' })
    const apps = Slop.apps.filter(a => !recent.includes(a.id))
    for (const a of apps.slice(0, 30)) items.push({ label: a.id, sub: [a.refs.draft != null ? 'draft ' + a.refs.draft : '', a.refs.main != null ? 'main ' + a.refs.main : 'not published', plural(a.instances.length, 'instance')].filter(Boolean).join(' · '), run: () => this.openProject(a.id) })
    if (!apps.length) items.push({ note: Slop.error || 'Every app you can develop is listed above.' })
    items.push({ hr: true }, { label: 'New app…', sub: 'an app store from a template, on draft', run: () => this.newAppDialog() }, { label: 'Import app…', sub: 'a .zip of an app\'s files', run: () => this.importDialog() })
    if (this.P) {
      items.push({ hr: true }, { label: 'Download ' + this.P.app, sub: '.zip of draft, with transcripts and the timeline', run: () => this.downloadProject() },
        { label: 'Reset dev data…', sub: 'drop your dev instance and start a fresh one', run: () => this.resetDev() },
        { label: 'Forget ' + this.P.app + ' here…', danger: true, run: () => this.forget() })
    }
    popMenu(btn, items)
  },
  wsMenu(btn) {
    const P = this.P, items = [{ group: 'Workspace' }, { label: 'draft', sub: 'where the app is developed (draft ' + (P.draft.head ?? '–') + ')', on: this.ws === 'draft', run: () => this.setWs('draft') }]
    for (const p of P.openProposals()) items.push({ label: p.title, sub: p.ref + (p.thread && P.threads.get(p.thread) ? ' · ' + P.threads.get(p.thread).title : ''), on: this.ws === p.ref, run: () => this.setWs(p.ref) })
    items.push({ hr: true }, { label: 'New proposal…', sub: 'edit in a copy of draft', run: () => this.newProposal() }, { label: 'Review proposals', run: () => Dock.open('review') })
    if (this.ws !== 'draft') items.push({ label: this.canvas && this.canvas.compare ? 'Stop comparing' : 'Compare with draft', sub: 'on the canvas', run: () => this.compare(!(this.canvas && this.canvas.compare)) })
    popMenu(btn, items)
  },
  healthMenu(btn) {
    const items = [{ group: 'Checks and errors' }], dev = Watch.status && Watch.status.dev
    if (dev && dev.broken) items.push({ label: 'dev instance · activation failed', sub: dev.broken.slice(0, 90), run: () => Dock.open('console') }, { label: 'Reset dev data', sub: 'a fresh dev instance (after a changed migration)', run: () => this.resetDev() })
    for (const fh of FrameHosts) {
      if (fh.headless || fh.project !== this.P) continue
      for (const l of fh.logs.filter(l => l.level === 'error').slice(-3)) items.push({ label: fh.route + ' · error', sub: l.text.slice(0, 70), run: () => Dock.open('console') })
      for (const i of fh.issues) {
        items.push({
          label: fh.route + ' ' + fh.w + 'px · ' + i.kind, sub: i.message.slice(0, 70), run: () => {
            if (i.src) { const [f, l] = i.src.split(':'); this.reveal(f, +l) }
            fh.call('select', [i.src ? { src: i.src } : i.selector]).then(info => info && this.select({ ...info, fid: fh.fid, route: fh.route, ws: fh.ws })).catch(() => { })
          }
        })
      }
    }
    if (items.length === 1) items.push({ note: 'No issues in the frames on the canvas.' })
    else items.push({ hr: true }, { label: 'Ask Claude to fix these', run: () => this.askAgent('Fix the check issues and errors the frames report.') })
    popMenu(btn, items, { right: true })
  },
  layoutMenu(btn) {
    const saved = this.prefs.layouts || {}
    const items = [{ group: 'Layouts' }, ...Object.keys(LAYOUTS).map(n => ({ label: n, run: () => Dock.set(LAYOUTS[n](), []) }))]
    if (Object.keys(saved).length) { items.push({ group: 'Saved' }); for (const [n, l] of Object.entries(saved)) items.push({ label: n, run: () => Dock.set(clone(l.layout), clone(l.floats || [])) }) }
    items.push({ hr: true }, { label: 'Save current as…', run: async () => { const n = await promptBox('Save layout', 'Name', 'My layout'); if (n) { this.prefs.layouts = { ...saved, [n]: { layout: clone(Dock.layout), floats: clone(Dock.floats) } }; this.savePrefs(); toast('Saved layout "' + n + '"') } } })
    if (Object.keys(saved).length) items.push({ label: 'Forget saved layouts', danger: true, run: () => { this.prefs.layouts = {}; this.savePrefs() } })
    items.push({ note: 'Drag a tab onto a strip to join, onto an edge to split, or outside to float.' })
    popMenu(btn, items, { right: true })
  },

  // ---- boot: the layers get their hooks, then the first app opens ----
  wire() {
    Object.assign(FrameHost.ui, {
      mode: () => this.mode, pinsFor: r => this.pinsFor(r), preview: () => Preview.payload(), health: () => this.ev.emit('health'),
      ready: fh => this.ev.emit('frameready', fh), hostFor: fid => this.hostFor(fid), log: (fh, l) => this.consoleAdd(l),
      pick: (fh, info) => this.select(info), placePin: (fh, m) => this.placePin(fh, m), openPin: (fh, id) => this.openPin(id, fh), textEdit: (fh, m) => this.textEdit(fh, m)
    })
    Object.assign(AgentUI, {
      ws: () => this.ws, setWs: ws => this.setWs(ws), selection: () => this.sel,
      focusFrame: id => this.canvas && this.canvas.focusFrame(id), fit: () => this.canvas && this.canvas.fit(), notify: t => toast(t)
    })
    Watch.onLog = l => this.consoleAdd(l)
    Watch.ev.on('status', () => { this.paintHeader(); this.ev.emit('health') })
    Records.ev.on('status', () => this.paintHeader())
    Agent.ev.on('turn', () => this.paintHeader()); Agent.ev.on('ready', () => this.paintHeader())
    Dock.ev.on('changed', () => this.savePrefs())
  },
  async boot() {
    if (/(^|\.)localhost$|^127\.0\.0\.1$/.test(location.hostname)) window.__SB = { App, Snaps, Headless, Agent, Slop, Watch, Projects }   // local test runs only
    const root = $('#app')
    clear(root)
    const work = h('div#work')
    root.append(this.header(), work)
    Dock.mount(work)
    this.wire()
    await Slop.init()
    this.prefs = Prefs.get('prefs', {})
    this.theme(this.prefs.theme || 'auto'); this.mode = this.prefs.mode || 'select'
    const valid = l => { try { let ok = true; walkTiles(normalize(clone(l)), t => { t.views = t.views.filter(v => Views[v]); if (!t.views.length) ok = false }); return ok } catch { return false } }
    Dock.set(this.prefs.layout && valid(this.prefs.layout) ? clone(this.prefs.layout) : LAYOUTS.Build(), this.prefs.floats || [])
    const first = Projects.recent().find(id => Slop.app(id)) || (Slop.apps[0] || {}).id
    if (!first || !(await this.openProject(first))) this.newAppDialog()
    Agent.init()
    this.dropImport()
    setTimeout(() => { if (!Sandbox.worker) Sandbox.spawn() }, 1200)
    document.addEventListener('keydown', e => {
      const t = e.target
      if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'v') this.setMode('select'); else if (k === 'p') this.setMode('play'); else if (k === 'c') this.setMode('comment')
      else if (k === 'escape' && this.traceTarget) { this.trace(null); this.ev.emit('trace', null) }
      else if (k === 'escape' && this.sel) { this.sel = null; this.ev.emit('sel', null); for (const fh of FrameHosts) if (!fh.headless) fh.post({ op: 'select', args: [null], id: 0 }); if (this.canvas) this.canvas.paintAll() }
    })
    this.paintHeader()
  }
}
