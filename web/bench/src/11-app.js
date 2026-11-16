// ---------- app: header, projects, workspaces, modes, selection, wiring, boot ----------
const App = {
  P: null, ws: 'main', mode: 'select', sel: null, logs: [], ev: emitter(), prefs: {}, canvas: null, offs: [], traceTarget: null,

  // ---- queries ----
  health() { let n = 0; for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) n += fh.issues.length + fh.errors; if (this.P && this.P.meta.app && Sync.act && Sync.act.broken) n++; return n },
  hostFor(fid) { return this.canvas ? this.canvas.hostFor(fid) : null },
  hostByFid(fid) { for (const fh of FrameHosts) if (fh.fid === fid) return fh; return null },
  firstHost() { for (const fh of FrameHosts) if (!fh.headless && fh.project === this.P) return fh; return null },
  pinsFor(route) { return this.P ? (this.P.meta.pins || []).filter(p => p.route === route) : [] },

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
  select(info) { if (this.traceTarget) this.trace(null); this.sel = info; this.ev.emit('sel', info); if (this.canvas) this.canvas.paintAll(); if (!Dock.visible('inspector') && !Dock.visible('code')) Dock.open('inspector') },
  placePin(host, m) { if (this.canvas) this.canvas.newPin(host, m) },
  openPin(id, host) { if (this.canvas) this.canvas.showPin(id, host) },
  textEdit(host, m) {
    const [file, line] = (m.src || '').split(':'), P = this.P, text = P.read(file, host.ws)
    if (text == null) return
    const off = offsetOfLine(text, +line), old = m.old.trim(), next = m.text.trim()
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    for (const cand of [old, esc(old), old.replace(/&/g, '&amp;')]) {
      const i = text.indexOf(cand, off)
      if (i >= 0 && i - off < 4000) { P.write(file, text.slice(0, i) + esc(next) + text.slice(i + cand.length), { ws: host.ws, who: 'you', note: 'text "' + old.slice(0, 24) + '" → "' + next.slice(0, 24) + '"' }); toast('Text updated in ' + file + ':' + lineOf(text, i)); return }
    }
    toast('Could not find that text in ' + file + ' (it may come from a script). Edit it in Code.'); host.load()
  },
  consoleAdd(l) { this.logs.push(l); if (this.logs.length > 1000) this.logs.splice(0, 200); this.ev.emit('log', l) },
  askAgent(text) { Dock.open('agent'); setTimeout(() => this.agentView && this.agentView.compose(text), 30) },
  showThread(tid) { Dock.open('agent'); if (this.agentView && this.P.threads.get(tid)) this.agentView.open(tid) },
  viewVersion(path, i) { Dock.open('code'); setTimeout(() => this.code && this.code.showVersion(path, i), 20) },
  openDoc(path) { Dock.open('docs'); setTimeout(() => this.docs && this.docs.open(path), 20) },
  reveal(file, line) { if (this.P.read(file, this.ws) === null && this.P.read(file, 'main') !== null && this.ws !== 'main') this.setWs('main'); Dock.open('code'); setTimeout(() => this.code && this.code.open(file, line), 20) },
  compare(on) { if (this.canvas) { this.canvas.compare = on && this.ws !== 'main'; this.canvas.sync() } this.paintHeader() },
  async addMark() { if (!this.P) return; const label = await promptBox('Add a mark', 'A label for this point in the session', 'Checkpoint ' + (this.P.marks().length + 1)); if (label) { this.P.mark({ label, by: 'you' }); toast('Marked') } },

  // ---- workspace and mode ----
  setWs(ws) {
    if (ws !== 'main' && (!this.P.overlays.get(ws) || this.P.overlays.get(ws).status !== 'open')) ws = 'main'
    if (this.code) this.code.commit()
    this.ws = ws; if (ws === 'main' && this.canvas) this.canvas.compare = false
    this.ev.emit('ws', ws); if (this.canvas) this.canvas.sync(); this.paintHeader()
  },
  setMode(m) { this.mode = m; for (const fh of FrameHosts) if (!fh.headless && fh.at == null) fh.push({ push: 'mode', mode: m }); if (this.canvas) this.canvas.paintAll(); this.paintHeader(); this.savePrefs() },

  // ---- prefs ----
  savePrefs: debounce(function () { Store.save('prefs', { theme: App.prefs.theme || 'auto', layout: Dock.layout, floats: Dock.floats, layouts: App.prefs.layouts || {}, mode: App.mode }) }, 800),
  theme(t) { this.prefs.theme = t; if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t; this.savePrefs() },

  // ---- projects ----
  async openProject(id) {
    // an app project's edits not yet in draft are pushed before it is let go
    if (this.P && this.P.meta.app && Slop.on) await Sync.flush()
    let P
    try { P = await Projects.open(id) } catch (e) { toast('Could not open that project: ' + e.message); return false }
    this.offs.forEach(f => f()); this.offs = []
    if (this.canvas) this.canvas.reset(); Headless.clear()
    this.P = P; this.ws = 'main'; this.sel = null; this.logs = []; this.playhead = null
    Projects.index.current = id; Projects.saveIndex()
    const reloadT = new Map()
    const reload = fh => { clearTimeout(reloadT.get(fh)); reloadT.set(fh, setTimeout(() => fh.load(), 180)) }
    this.offs.push(
      // an embedded frame (the dev instance) reloads when slop says draft moved, not on the edit itself
      P.ev.on('files', (ws, paths) => { for (const fh of FrameHosts) if (fh.project === P && (ws === 'main' || fh.ws === ws)) { if (fh.embed) continue; if (fh.headless) fh.stale = true; else reload(fh) } this.ev.emit('files', ws, paths); this.paintHeader() }),
      P.ev.on('tables', name => { for (const fh of FrameHosts) if (fh.project === P) fh.push({ push: 'db', table: name }); this.ev.emit('tables', name) }),
      P.ev.on('marks', () => this.snapMarkSoon(P)),
      P.ev.on('overlays', () => { if (this.ws !== 'main' && (!P.overlays.get(this.ws) || P.overlays.get(this.ws).status !== 'open')) this.setWs('main'); this.ev.emit('overlays'); this.paintHeader(); if (this.canvas) this.canvas.sync() }),
      P.ev.on('frames', () => { if (this.canvas) this.canvas.sync() }),
      P.ev.on('events', e => this.ev.emit('events', e)),
      P.ev.on('threads', () => this.ev.emit('threads')),
      P.ev.on('marks', () => this.ev.emit('events')),
      this.ev.on('pins', () => { for (const fh of FrameHosts) if (!fh.headless && fh.project === P) fh.push({ push: 'pins', pins: this.pinsFor(fh.route) }) }),
      this.ev.on('health', () => { this.paintHeader(); Dock.refreshTabs() }),
      ...this.autoMarks(P))
    Sync.attach(P.meta.app ? P : null); Outside.start(P)
    this.ev.emit('project', P)
    if (this.canvas) this.canvas.sync()
    this.paintHeader()
    return true
  },
  // the playhead: the canvas shows main's pages as they were just after event i (null: now)
  playhead: null,
  setPlayhead(i) {
    const P = this.P; if (!P) return
    if (i != null) i = clamp(Math.round(i), 0, P.events.length - 1)
    if (i === this.playhead) return
    const was = this.playhead; this.playhead = i
    if (this.canvas) { if ((was == null) !== (i == null)) this.canvas.sync(); this.canvas.playhead() }
    this.ev.emit('playhead', i)
  },
  // events that change what main's pages look like (the playhead steps through these)
  pageEvents(P) { return P.events.filter(e => e.kind === 'init' || ((e.kind === 'write' || e.kind === 'remove') && e.ws === 'main')) },
  // a mark keeps frozen copies of the board's frames as they are, for the timeline and later comparison
  snapMarkSoon(P) {
    clearTimeout(this.snapT)
    this.snapT = setTimeout(async () => {
      if (P !== this.P) return
      const e = P.marks().slice(-1)[0]; if (!e || Snaps.list(P).some(s => s.events.includes(e.i))) return
      try { await snapshotBoard(P, 'main', { event: e.i, by: 'ide' }); this.ev.emit('events') } catch { }
    }, 700)
  },
  autoMarks(P) {
    const t0 = now(); let prev = null, errState = false
    const settle = () => now() - t0 > 4000 && this.P === P
    const hosts = () => [...FrameHosts].filter(fh => !fh.headless && fh.project === P)
    const check = debounce(() => {
      if (hosts().some(fh => fh.loading)) return check()
      const n = this.health(), errs = hosts().reduce((s, fh) => s + fh.errors, 0)
      if (settle() && prev > 0 && n === 0) P.mark({ label: 'All checks pass', by: 'ide', kind: 'auto' })
      if (!errs) errState = false
      prev = n
    }, 1200)
    return [this.ev.on('health', check), this.ev.on('log', l => {
      if (l.level !== 'error' || errState || !settle()) return
      errState = true; P.mark({ label: 'First error: ' + l.text.slice(0, 60), note: l.frame + (l.src ? ' @' + l.src : ''), by: 'ide', kind: 'auto' })
    })]
  },
  newProjectDialog() {
    let pick = 'coffee'
    const name = h('input.txt', { value: '', placeholder: 'Name (optional)', style: { width: '100%' } })
    const cards = h('div.tcards')
    const paint = () => { clear(cards); for (const t of TEMPLATES) cards.appendChild(h('button' + (t.id === pick ? '.on' : ''), { on: { click: () => { pick = t.id; paint() }, dblclick: () => go() } }, h('b', t.name), h('small', t.blurb), h('small', Object.keys(t.files).length + ' files' + (Object.keys(t.tables).length ? ' · ' + Object.keys(t.tables).length + ' tables' : '')))) }
    const go = async () => { m.close(); const p = await Projects.create({ template: pick, title: name.value.trim() || undefined }); await this.openProject(p.id); toast('New project: ' + p.title) }
    paint()
    const m = modal({ title: 'New project', body: [h('p.note', 'Each project is its own repository: files, tables, proposals, threads and timeline. Try ideas side by side.'), cards, name], actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, run: () => { go(); return false } }] })
  },
  async publishDialog() {
    const P = this.P; if (!P || !P.meta.app) return
    let pf
    try { pf = await Publish.preflight(P) } catch (e) { toast('Could not check ' + P.meta.app + ': ' + (e.message || e), 5000); return }
    const nothing = pf.refs.draft === pf.refs.main, blocked = pf.blockers.length > 0
    const lines = Publish.lines(pf).map(l => h('div', { style: { margin: '2px 0', color: /^BLOCKED/.test(l) ? 'var(--bad, #c00)' : '' } }, l))
    modal({ title: 'Publish ' + P.meta.app, wide: true, body: [h('p.note', 'Publishing moves main to this draft. Production instances run it on their next view; a migration runs on each. You can roll back.'), h('div.mono', { style: { fontSize: '12px' } }, lines)],
      actions: [{ label: 'Cancel' }, ...(nothing || blocked ? [] : [{ label: 'Publish draft ' + pf.refs.draft, primary: true, run: async () => {
        try { const r = await Publish.run(P, pf); toast('Published draft ' + r.n + ' to main'); this.rolloutDialog(r.n, r.from) }
        catch (e) { toast('Not published: ' + (e.message || e), 6000) }
      } }])] })
  },
  async rolloutDialog(n, from) {
    const P = this.P; if (!P || !P.meta.app) return
    let pf; try { pf = await Slop.call('preflight', { app: P.meta.app }) } catch (e) { return }
    const list = h('div.mono', { style: { fontSize: '12px' } })
    const paint = rows => { clear(list); for (const x of rows) list.append(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', margin: '3px 0' } }, h('span', { style: { flex: 1 } }, x.store + ' @' + x.n + (x.broken ? ' · broken: ' + x.broken.slice(0, 80) : x.n === n ? ' · on ' + n : ' · activates on its next view')),
      x.n === n ? null : h('button.btn.sm', { on: { click: async () => { try { Object.assign(x, await Slop.call('activate', { store: x.store })); paint(rows) } catch (e) { toast(e.message || String(e)) } } } }, 'Activate now'))) }
    paint(pf.production)
    if (!pf.production.length) list.append(h('div', 'No production instance follows main yet. Mount the app or make an instance (slop store new <id> --app ' + P.meta.app + ').'))
    modal({ title: 'Published draft ' + n, wide: true, body: [h('p.note', 'Instances that follow main:'), list],
      actions: [{ label: from ? 'Roll back to ' + from : 'Close', danger: !!from, run: async () => { if (!from) return; try { await Publish.rollback(P, from, n); toast('main is back at ' + from) } catch (e) { toast('Not rolled back: ' + (e.message || e), 6000) } } }, ...(from ? [{ label: 'Done', primary: true }] : [])] })
  },
  async resetDev() {
    const P = this.P; if (!P || !P.meta.app) return
    if (!await confirmBox('Reset dev data?', 'Your dev instance of ' + P.meta.app + ' and its data are dropped, and a fresh one runs draft. The app and its other instances are not touched.', 'Reset')) return
    try { await Slop.call('resetDev', { app: P.meta.app }) } catch (e) { toast('Could not reset: ' + (e.message || e), 5000); return }
    Embeds.ready.delete(P.meta.app); Sync.act = null; Sync.ev.emit('status', Sync.status)
    for (const fh of FrameHosts) if (fh.project === P && fh.embed) fh.load({ keepState: false })
    toast('A fresh dev instance of ' + P.meta.app)
  },
  newAppDialog() {
    const id = h('input.txt', { value: '', placeholder: 'id: lowercase letters, digits and -', style: { width: '100%' } })
    const title = h('input.txt', { value: '', placeholder: 'Title (optional)', style: { width: '100%' } })
    const go = async () => {
      const v = id.value.trim()
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v)) { toast('The id is a store id: lowercase letters, digits and -, at most 63'); return false }
      try { await Projects.createApp({ id: v, title: title.value.trim() || v }); await this.openProject(v); toast('New app ' + v + ' (on draft; publish to make it visible)') }
      catch (e) { toast('Could not create ' + v + ': ' + (e.message || e), 5000) }
    }
    modal({ title: 'New slop app', body: [h('p.note', 'An app store with app.json and a page. Your edits go to its draft ref; nothing is visible to others until you publish it.'), id, title], actions: [{ label: 'Cancel' }, { label: 'Create', primary: true, run: go }] })
    setTimeout(() => id.focus(), 0)
  },
  async duplicate() { const d = this.P.export(); d.title = this.P.title + ' copy'; const p = await Projects.create({ data: d }); await this.openProject(p.id); toast('Duplicated as "' + p.title + '"') },
  async rename() { const t = await promptBox('Rename project', 'Title', this.P.title); if (t) { this.P.meta.title = t; this.P.saveMeta(); this.paintHeader() } },
  async remove() {
    const P = this.P
    if (P.meta.app) {
      if (!await confirmBox('Forget "' + P.title + '" here?', 'The bench forgets its threads, timeline, proposals and boards for this app. The app store, its files, refs and instances stay as they are.', 'Forget')) return
    } else if (!await confirmBox('Delete "' + P.title + '"?', 'Its files, tables, proposals, threads and timeline are deleted from storage. Export it first if you may want it back.', 'Delete project')) return
    const id = P.id; await Projects.remove(id)
    const next = Projects.index.projects[0]
    if (next) await this.openProject(next.id); else { const p = await Projects.create({ template: 'blank', title: 'Untitled' }); await this.openProject(p.id) }
    toast('Deleted')
  },
  async downloadProject() {
    toast('Packing ' + this.P.title + '…')
    try { const blob = await projectZip(this.P); await saveFile(slug(this.P.title) + '.sitebench.zip', blob) } catch (e) { toast('Could not build the zip: ' + e.message) }
  },
  async importFile(file) {
    try {
      const data = await readArchive(await file.arrayBuffer(), file.name || 'import')
      const p = await Projects.create({ data }); await this.openProject(p.id)
      toast('Imported "' + p.title + '": ' + plural(p.files.size, 'file') + (p.threads.size ? ', ' + plural(p.threads.size, 'thread') : ''))
      return true
    } catch (e) { toast('Import failed: ' + e.message, 5000); return false }
  },
  importDialog() {
    const input = h('input', { type: 'file', accept: '.zip,.json,application/zip,application/json', style: { display: 'none' }, on: { change: async () => { if (input.files[0] && await this.importFile(input.files[0])) m.close() } } })
    const drop = h('div', { style: { border: '1px dashed var(--ink-2)', padding: '28px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' } },
      h('b', 'Drop a .zip or .json here'), h('span.note', 'A Sitebench export (files, tables, proposals, threads, timeline), or any zip of site files.'),
      h('button.btn', { on: { click: () => input.click() } }, 'Choose a file…'), input)
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--accent)' })
    drop.addEventListener('dragleave', () => { drop.style.borderColor = '' })
    drop.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f && await this.importFile(f)) m.close() })
    const ta = h('textarea.txt.mono', { placeholder: '{"sitebench": 1, "files": {...}}', style: { width: '100%', height: '140px', fontSize: '11px' } })
    const paste = h('details', h('summary', { style: { cursor: 'pointer' } }, 'Or paste exported JSON'), ta, h('div', { style: { marginTop: '6px' } }, h('button.btn.sm', { on: { click: async () => {
      let d; try { d = JSON.parse(ta.value) } catch { return toast('That is not valid JSON') }
      if (!d || typeof d.files !== 'object') return toast('No files in that JSON')
      const p = await Projects.create({ data: d }); await this.openProject(p.id); m.close(); toast('Imported "' + p.title + '"')
    } } }, 'Import JSON')))
    const m = modal({ title: 'Import a project', body: [drop, paste, h('p.note', 'It comes in as a new project; nothing you have is changed.')], actions: [{ label: 'Close' }] })
  },
  // dropping a zip anywhere on the workbench imports it
  dropImport() {
    let depth = 0
    const hint = h('div.drop-hint', { hidden: true, style: { inset: '8px' } }, h('span', 'Drop to import as a new project'))
    document.body.appendChild(hint)
    const files = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    addEventListener('dragenter', e => { if (!files(e) || $('.modal')) return; depth++; hint.hidden = false; document.body.classList.add('moving') })
    addEventListener('dragleave', e => { if (!files(e)) return; if (--depth <= 0) { depth = 0; hint.hidden = true; document.body.classList.remove('moving') } })
    addEventListener('dragover', e => { if (files(e)) e.preventDefault() })
    addEventListener('drop', e => {
      if (!files(e)) return
      e.preventDefault(); depth = 0; hint.hidden = true; document.body.classList.remove('moving')
      if ($('.modal')) return
      const f = e.dataTransfer.files[0]; if (f && /\.(zip|json)$/i.test(f.name)) this.importFile(f); else if (f) toast('Drop a .zip or .json project')
    })
  },

  // ---- header ----
  header() {
    this.hdr = {
      proj: h('button.projbtn', { on: { click: e => this.projectMenu(e.currentTarget) } }),
      ws: h('button.wsbtn', { title: 'Workspace: main, or a proposal on top of it', on: { click: e => this.wsMenu(e.currentTarget) } }),
      modes: h('div.seg.modes', [['select', 'Select', 'V'], ['play', 'Play', 'P'], ['comment', 'Comment', 'C']].map(([m, l, k]) => h('button', { 'data-m': m, title: l + ' (' + k + ')', on: { click: () => this.setMode(m) } }, l))),
      health: h('button.pill', { title: 'Layout, contrast and a11y checks, plus page errors', on: { click: e => this.healthMenu(e.currentTarget) } }),
      agent: h('button.pill.hide-s', { title: 'Claude', on: { click: () => Dock.open('agent') } }),
      store: h('button.pill.hide-s', { on: { click: () => { Store.flush(); if (this.P && this.P.meta.app) Sync.run() } } }),
      publish: h('button.btn.primary', { title: 'Publish draft to main: what people use', style: { display: 'none' }, on: { click: () => this.publishDialog() } }, 'Publish')
    }
    const H = this.hdr
    return h('header.bar', h('div.brand', 'Sitebench', h('i', 'live site workbench')),
      h('div.rel', H.proj), h('div.rel', H.ws), H.modes, h('span.sp'),
      h('div.rel', H.health), H.agent, H.store, H.publish,
      h('button.btn.hide-s', { title: 'Bookmark this moment on the timeline', on: { click: () => this.addMark() } }, '+ Mark'),
      h('div.rel', h('button.btn', { on: { click: e => this.layoutMenu(e.currentTarget) } }, 'Layout')),
      h('button.ibtn', { title: 'Theme', on: { click: () => this.theme({ auto: 'dark', dark: 'light', light: 'auto' }[this.prefs.theme || 'auto']) } }, '◐'))
  },
  paintHeader() {
    const H = this.hdr; if (!H || !this.P) return
    const P = this.P, ov = this.ws !== 'main' ? P.overlays.get(this.ws) : null
    clear(H.proj).append(h('span.ptitle', P.title), h('span.pcode', P.files.size + ' files'), h('span.caret', '▾'))
    put(clear(H.ws), h('span.dot' + (ov ? '.busy' : '.ok')), ov ? 'Proposal: ' + (ov.title.length > 24 ? ov.title.slice(0, 24) + '…' : ov.title) : 'main', ov ? h('span.note', ' ' + P.changes(ov.id).length + ' changed') : null, h('span.caret', '▾'))
    for (const b of H.modes.children) b.classList.toggle('on', b.dataset.m === this.mode)
    const n = this.health()
    H.health.className = 'pill' + (n ? ' bad' : ''); clear(H.health).append(h('b', String(n)), h('span', n === 1 ? 'issue' : 'issues'))
    const busy = Agent.anyBusy()
    H.agent.className = 'pill hide-s' + (busy ? ' busy' : ''); clear(H.agent).append(h('b', busy ? 'Working' : Agent.sample ? 'Idle' : Agent.ready ? 'Off' : '…'), h('span', 'Claude'))
    H.publish.style.display = P.meta.app && Slop.on ? '' : 'none'
    if (P.meta.app) {
      // An app project: where draft is, and the visitor's dev instance on it.
      const l = Sync.label(), bad = Sync.status === 'error' || (Sync.act && Sync.act.broken)
      H.store.title = 'App store ' + P.meta.app + ': edits go to its draft ref' + (l.title ? ' · ' + l.title : '') + ' (click to push now)'
      H.store.className = 'pill hide-s' + (bad ? ' bad' : '')
      clear(H.store).append(h('b', l.status), h('span', l.dev || 'app'))
    } else {
      const [lbl, where] = Store.label().split('|')
      H.store.title = where + (Store.error ? ' · ' + Store.error : '') + ' (click to save now)'; H.store.className = 'pill hide-s' + (Store.status === 'error' ? ' bad' : '')
      clear(H.store).append(h('b', lbl.split(' · ')[1]), h('span', lbl.split(' · ')[0]))
    }
  },
  projectMenu(btn) {
    const items = [{ group: Slop.on ? 'Recent' : 'Projects in this artifact' }]
    for (const p of Projects.index.projects) items.push({ label: (p.app ? '▣ ' : '') + p.title, sub: (p.app ? 'app · ' : '') + (p.files || '?') + ' files · ' + fmtAgo(p.updated), on: this.P && p.id === this.P.id, run: () => { if (!this.P || p.id !== this.P.id) this.openProject(p.id) } })
    if (Slop.on) {
      items.push({ group: 'Apps on this server' })
      const opened = new Set(Projects.index.projects.map(p => p.id))
      const apps = Slop.apps.filter(a => !opened.has(a.id))
      for (const a of apps.slice(0, 30)) items.push({ label: '▣ ' + a.id, sub: [a.refs.draft != null ? 'draft ' + a.refs.draft : '', a.refs.main != null ? 'main ' + a.refs.main : 'not published', plural(a.instances.length, 'instance')].filter(Boolean).join(' · '), run: () => this.openProject(a.id) })
      if (!apps.length) items.push({ note: Slop.error || 'Every app you can develop is in the list above.' })
      items.push({ label: 'New slop app…', sub: 'an app store with a page, on draft', run: () => this.newAppDialog() })
      if (this.P && this.P.meta.app) items.push({ label: 'Reset dev data…', sub: 'drop your dev instance of ' + this.P.meta.app + ' and start a fresh one', run: () => this.resetDev() })
    }
    items.push({ hr: true }, { label: 'New project…', sub: 'from a template', run: () => this.newProjectDialog() }, { label: 'Duplicate', sub: 'try an idea on a copy', run: () => this.duplicate() },
      { label: 'Rename…', run: () => this.rename() }, { label: 'Download project', sub: '.zip with transcripts and timeline', run: () => this.downloadProject() }, { label: 'Import project…', sub: '.zip or .json', run: () => this.importDialog() },
      { hr: true }, { label: 'Delete project…', danger: true, run: () => this.remove() }, { note: Store.label().split('|')[1] + '.' })
    popMenu(btn, items)
  },
  wsMenu(btn) {
    const P = this.P, items = [{ group: 'Workspace' }, { label: 'main', sub: 'the files as they are', on: this.ws === 'main', run: () => this.setWs('main') }]
    for (const ov of P.openOverlays()) items.push({ label: ov.title, sub: (ov.by === 'agent' ? 'Claude' : 'you') + ' · ' + plural(P.changes(ov.id).length, 'change'), on: this.ws === ov.id, run: () => this.setWs(ov.id) })
    items.push({ hr: true }, { label: 'New draft', sub: 'edit in a proposal of your own', run: () => { const ov = P.newOverlay({ title: 'My draft ' + (P.overlays.size + 1) }); this.setWs(ov.id) } },
      { label: 'Review proposals', run: () => Dock.open('review') })
    if (this.ws !== 'main') items.push({ label: this.canvas && this.canvas.compare ? 'Stop comparing' : 'Compare with main', sub: 'on the canvas', run: () => this.compare(!(this.canvas && this.canvas.compare)) })
    popMenu(btn, items)
  },
  healthMenu(btn) {
    const items = [{ group: 'Checks and errors' }]
    if (this.P.meta.app && Sync.act && Sync.act.broken) items.push({ label: 'dev instance · activation failed', sub: Sync.act.broken.slice(0, 90), run: () => Dock.open('console') }, { label: 'Reset dev data', sub: 'a fresh dev instance (after a changed migration)', run: () => this.resetDev() })
    for (const fh of FrameHosts) {
      if (fh.headless || fh.project !== this.P) continue
      for (const l of fh.logs.filter(l => l.level === 'error').slice(-3)) items.push({ label: fh.route + ' · error', sub: l.text.slice(0, 70), run: () => Dock.open('console') })
      for (const i of fh.issues) items.push({ label: fh.route + ' ' + fh.w + 'px · ' + i.kind, sub: i.message.slice(0, 70), run: () => { if (i.src) { const [f, l] = i.src.split(':'); this.reveal(f, +l) } fh.call('select', [i.src ? { src: i.src } : i.selector]).then(info => info && this.select({ ...info, fid: fh.fid, route: fh.route, ws: fh.ws })).catch(() => { }) } })
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

  // ---- boot ----
  async boot() {
    Streams.init()
    if (/(^|\.)localhost$|^127\.0\.0\.1$/.test(location.hostname)) window.__SB = { App, Snaps, Headless, Agent, Sync, Slop, Outside, Projects, Store }   // local test runs only (a local slop serves the bench on *.localhost)

    const root = $('#app')
    clear(root)
    const work = h('div#work')
    root.append(this.header(), work)
    Dock.mount(work)
    Store.ev.on('status', () => this.paintHeader())
    Agent.ev.on('turn', () => this.paintHeader()); Agent.ev.on('ready', () => this.paintHeader())
    await Store.init()
    Sync.ev.on('status', () => this.paintHeader())
    await Slop.init()
    this.prefs = (await Store.get('prefs')) || {}
    this.theme(this.prefs.theme || 'auto'); this.mode = this.prefs.mode || 'select'
    await Projects.load()
    let first = Projects.index.current && Projects.index.projects.find(p => p.id === Projects.index.current)
    if (!first) first = Projects.index.projects[0]
    if (!first) { const p = await Projects.create({ template: 'coffee' }); first = { id: p.id } }
    const valid = l => { try { let ok = true; walkTiles(normalize(clone(l)), t => { t.views = t.views.filter(v => Views[v]); if (!t.views.length) ok = false }); return ok } catch { return false } }
    Dock.set(this.prefs.layout && valid(this.prefs.layout) ? clone(this.prefs.layout) : LAYOUTS.Build(), this.prefs.floats || [])
    if (!(await this.openProject(first.id))) { const p = await Projects.create({ template: 'coffee' }); await this.openProject(p.id) }
    Agent.init()
    this.dropImport()
    setTimeout(() => { if (!Sandbox.worker) Sandbox.spawn() }, 1200)
    document.addEventListener('keydown', e => {
      const t = e.target; if (t.closest && t.closest('input, textarea, select, [contenteditable]')) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'v') this.setMode('select'); else if (k === 'p') this.setMode('play'); else if (k === 'c') this.setMode('comment')
      else if (k === 'escape' && this.traceTarget) { this.trace(null); this.ev.emit('trace', null) }
      else if (k === 'escape' && this.sel) { this.sel = null; this.ev.emit('sel', null); for (const fh of FrameHosts) if (!fh.headless) fh.post({ op: 'select', args: [null], id: 0 }); if (this.canvas) this.canvas.paintAll() }
    })
    this.paintHeader()
  }
}
App.boot().catch(e => { console.error(e); const r = $('#app'); clear(r).appendChild(h('div.boot', h('div', h('b', 'Sitebench could not start'), h('pre.note', String(e && e.stack || e))))) })
