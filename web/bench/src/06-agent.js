// ---------- sandbox: QuickJS (wasm) in a worker, with a page-side watchdog ----------
const Sandbox = {
  worker: null, engine: 'off', seq: 0, runs: new Map(), ev: emitter(), tried: 0,
  async spawn() {
    this.engine = 'loading'; this.ev.emit('engine')
    const attach = w => {
      w.onmessage = e => this.onMessage(e.data || {})
      w.onerror = e => { e.preventDefault && e.preventDefault(); if (this.engine === 'loading') { this.engine = 'off'; this.ev.emit('engine') } }
      this.worker = w
    }
    try { attach(new Worker('sandbox.js')) }
    catch (e1) {
      try { const src = await (await fetch('sandbox.js')).text(); attach(new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))) }
      catch (e2) { this.engine = 'off'; this.ev.emit('engine'); return }
    }
    setTimeout(() => { if (this.engine === 'loading') { this.engine = 'off'; this.ev.emit('engine') } }, 15000)
  },
  onMessage(m) {
    if (m.type === 'engine') { this.engine = m.engine; this.ev.emit('engine'); return }
    if (m.type === 'call') {
      const run = this.runs.get(m.eid)
      const reply = (ok, v) => this.worker && this.worker.postMessage(ok ? { type: 'reply', id: m.id, ok: true, value: v } : { type: 'reply', id: m.id, ok: false, error: v })
      if (!run) return reply(false, { kind: 'gone', message: 'eval finished' })
      if (m.name === 'sleep') { setTimeout(() => reply(true, null), clamp(+m.args[0] || 0, 0, 5000)); return }
      const fn = run.api[m.name]
      if (!fn) return reply(false, { kind: 'unknown', message: m.name + ' is not part of the API' })
      run.calls.push(m.name)
      const args = m.args || [], bad = checkArgs(m.name, args)
      if (bad) return reply(false, { kind: 'invalid', message: bad })
      const long = LONG_CALLS.has(m.name)
      if (long && run.long++ === 0) run.pausedAt = Date.now()
      const done = () => { if (long && --run.long === 0) run.extra += Date.now() - run.pausedAt }
      Promise.resolve().then(() => fn(...args)).finally(done).then(v => {
        let out = v === undefined ? null : v
        try { out = JSON.parse(JSON.stringify(out)) } catch { out = String(out) }
        reply(true, out)
      }, err => {
        const kind = err && err.kind || (err instanceof TypeError ? 'invalid' : 'error')
        let message = String(err && err.message || err)
        if (kind === 'invalid' && API_SIGS[m.name]) message += ' · usage: ' + m.name + '(' + API_SIGS[m.name] + ')'
        reply(false, { kind, message })
      })
      return
    }
    if (m.type === 'result') {
      const run = this.runs.get(m.id); if (!run) return
      clearInterval(run.timer); this.runs.delete(m.id)
      run.resolve({ ok: m.ok, value: m.value, error: m.error, logs: m.logs || [], engine: m.engine, ms: m.ms, calls: run.calls, scope: m.scope, fresh: m.fresh })
    }
  },
  // opts: sid (keep this session's variables between evals), restore (its saved variables), lib ([{name, source}])
  async run(code, api, { timeoutMs = 20000, sid, restore, lib } = {}) {
    if (!this.worker) await this.spawn()
    if (this.engine === 'loading') await new Promise(r => { const off = this.ev.on('engine', () => { if (this.engine !== 'loading') { off(); r() } }) })
    if (this.engine === 'off') return { ok: false, error: { kind: 'unavailable', message: 'the sandbox worker could not start in this view' }, logs: [] }
    const id = ++this.seq
    return new Promise(resolve => {
      const run = { resolve, api, calls: [], long: 0, extra: 0, pausedAt: 0 }, t0 = Date.now()
      run.timer = setInterval(() => {          // the engine interrupts itself; this catches a wedged worker
        if (run.long > 0 || Date.now() - t0 - run.extra < timeoutMs + 5000) return
        clearInterval(run.timer); this.runs.delete(id); try { this.worker.terminate() } catch { } this.worker = null
        for (const [, r] of this.runs) { clearInterval(r.timer); r.resolve({ ok: false, error: { kind: 'timeout', message: 'sandbox restarted' }, logs: [] }) } this.runs.clear()
        resolve({ ok: false, error: { kind: 'timeout', message: 'eval exceeded ' + Math.round(timeoutMs / 1000) + ' s; the sandbox was restarted (variables come back from their last saved values)' }, logs: [] })
        this.spawn()
      }, 1000)
      this.runs.set(id, run)
      this.worker.postMessage({ type: 'eval', id, code, api: Object.keys(api), timeoutMs, sid, restore: restore || null, lib: lib || [], sigs: API_SIGS, roles: Object.keys(ROLES) })
    })
  },
  drop(sid) { if (this.worker) this.worker.postMessage({ type: 'drop', sid }) }
}

const LONG_CALLS = new Set(['agents.delegate', 'llm', 'ui.approve', 'ui.ask', 'session.waitFor', 'scenarios.run', 'scenarios.runAll'])
// signatures: a parameter ending in ? is optional. Used to check calls and to say how to call a verb.
const API_SIGS = {
  'files.list': 'prefix?', 'files.read': 'path', 'files.exists': 'path', 'files.lines': 'path, from?, to?', 'files.write': 'path, text',
  'files.replace': 'path, find, replacement, {all}?', 'files.remove': 'path', 'files.grep': 'regex, {path, flags}?', 'files.blame': 'path, {from, to}?',
  'data.tables': '', 'data.rows': 'table, where?', 'data.define': 'table, cols', 'data.insert': 'table, row', 'data.update': 'table, id, patch', 'data.remove': 'table, id', 'data.drop': 'table',
  'frames.list': '', 'frames.open': 'route, {w, h, x, y, label, fixture, new}?', 'frames.update': 'frameId, {route, w, h, x, y, label, fixture}', 'frames.move': 'frameId, x, y', 'frames.close': 'frameId',
  'frames.label': 'frameId, label?', 'frames.arrange': 'rows, {gap, rowGap, x, y}?', 'frames.focus': 'frameId?',
  'frames.outline': 'frameId?', 'frames.inspect': 'frameId, target', 'frames.check': 'frameId?', 'frames.click': 'frameId, target', 'frames.type': 'frameId, target, text',
  'frames.text': 'frameId?, target?', 'frames.query': 'frameId, selector', 'frames.console': 'frameId?', 'frames.reload': 'frameId?',
  'frames.waitFor': 'frameId, selector, {timeout}?', 'frames.count': 'frameId, selector', 'frames.layout': 'frameId?, {near}?', 'frames.snapshot': 'frameId?, label?',
  'frames.compare': 'frameId, {with}?', 'frames.data': 'frameId?', 'snapshots.list': '{route}?',
  'fixtures.list': '', 'fixtures.save': 'name, {tables, store, clock, description}', 'fixtures.capture': 'name, {tables, clock}?',
  'scenarios.list': '', 'scenarios.read': 'name', 'scenarios.save': 'name, spec', 'scenarios.run': 'nameOrSpec', 'scenarios.runAll': '',
  'ui.panel': 'id, spec', 'ui.values': 'id', 'ui.set': 'id, controlId, value', 'ui.ask': 'id, spec?, {label}?', 'ui.panels': '', 'ui.closePanel': 'id',
  'ui.selection': '', 'ui.pins': '{all}?', 'ui.resolvePin': 'pinId, note?', 'ui.notify': 'text', 'ui.pin': 'frameId, target, text', 'ui.approve': 'title, detail?',
  'llm': 'prompt, {output, tier}?', 'agents.delegate': 'role, task, {output, evals, tier, proposal}?', 'agents.roles': '',
  'tx.begin': '', 'tx.commit': '', 'tx.rollback': '', 'dry.begin': '', 'dry.end': '', 'dry.apply': 'id, paths?', 'dry.discard': 'id',
  'session.recall': 'query, {limit, thread, all}?', 'session.message': 'n, {thread}?', 'session.stream': '{kind, frame, since, limit}?', 'session.waitFor': 'kind, {frame, match, timeout}?',
  'session.mark': 'label, {kind, why}?', 'session.marks': '', 'session.events': '{kind, path, since, limit}?', 'session.diff': 'markLabelOrIndex', 'session.workspace': '',
  'lib.def': 'name, fn, {description}?', 'lib.list': '', 'lib.remove': 'name', 'lib.source': 'name', 'log': '...values'
}
function checkArgs(name, args) {
  const sig = API_SIGS[name]; if (sig == null || sig.startsWith('...')) return null
  const req = sig ? sig.split(/,\s*(?![^{]*})/).filter(p => p && !p.endsWith('?')) : []
  const missing = req.filter((p, i) => args[i] === undefined || args[i] === null)
  return missing.length ? name + ' needs ' + req.join(', ') + ' (missing ' + missing.join(', ') + ') · usage: ' + name + '(' + sig + ')' : null
}

// ---------- saved functions: .agent/lib/<name>.js, rebuilt by running their source ----------
const LIB_DIR = '.agent/lib/'
function libEntries(P, ws) {
  return P.list(ws).filter(p => p.startsWith(LIB_DIR) && p.endsWith('.js')).map(path => {
    const text = P.read(path, ws) || '', name = path.slice(LIB_DIR.length, -3)
    let meta = {}; const mm = /^\/\/ @lib (\{.*\})$/m.exec(text); if (mm) { try { meta = JSON.parse(mm[1]) } catch { } }
    const i = text.indexOf('export default ')
    return { name, path, source: (i >= 0 ? text.slice(i + 15) : text).trim(), description: meta.description || '', params: meta.params || [] }
  }).filter(l => /^[A-Za-z_$][\w$]*$/.test(l.name))
}

// ---------- the host API: what code in the sandbox can do (the same API for the agent and the Eval panel) ----------
function hostAPI(ctx) {
  const P = ctx.project, ws = () => ctx.ws, who = ctx.who
  const policy = msg => Object.assign(new Error(msg), { kind: 'policy' })
  const writable = path => {
    if (ctx.mode === 'read') throw policy('read-only mode: this thread may read and check but not write')
    if (ctx.mode === 'tests' && !(path && /^(scenarios|fixtures)\//.test(path))) throw policy('this thread may write only scenarios/ and fixtures/ (tests), not code or data')
  }
  const need = (v, name) => { if (typeof v !== 'string' || !v) throw Object.assign(new Error(name + ' must be a non-empty string'), { kind: 'invalid' }); return v }
  // a dry run (step.dry()) keeps file writes in ctx.scratch; reads see them, the project does not
  const rd = path => ctx.scratch && ctx.scratch.files.has(path) ? ctx.scratch.files.get(path) : P.read(path, ws())
  const ls = () => { const set = new Set(P.list(ws())); if (ctx.scratch) for (const [p, t] of ctx.scratch.files) t === null ? set.delete(p) : set.add(p); return [...set].sort() }
  const wr = (path, text, note) => { if (ctx.scratch) { ctx.scratch.files.set(path, text); return } touchFile(path); P.write(path, text, { ws: ws(), ...meta, note }) }
  const rm = path => { if (ctx.scratch) { ctx.scratch.files.set(path, null); return } touchFile(path); P.remove(path, { ws: ws(), ...meta }) }
  const noDryData = () => { if (ctx.scratch) throw policy('dry runs capture file writes only; data writes are refused inside .dry()') }
  const readOrThrow = path => { need(path, 'path'); const t = rd(path); if (t === null) throw Object.assign(new Error('no file ' + path + '. Files: ' + ls().join(', ')), { kind: 'missing' }); return t }
  const meta = { who, thread: ctx.thread }
  // an eval is a transaction: remember what each file and table was before its first write, to roll back on failure
  const txFrames = () => [ctx.tx, ...(ctx.txStack || [])].filter(Boolean)
  const touchFile = path => {
    const open = txFrames().filter(f => !f.files.has(path)); if (!open.length) return
    const w = ws(), ov = w !== 'main' ? P.overlays.get(w) : null
    // ext: the hash-only entry a write on main replaces (a binary or large file the bench does not load)
    const snap = { text: P.read(path, w), ext: w === 'main' ? P.extern.get(path) : undefined, inOv: !!ov && Object.prototype.hasOwnProperty.call(ov.files, path), ovText: ov ? ov.files[path] : undefined, hadBase: !!ov && Object.prototype.hasOwnProperty.call(ov.base, path) }
    for (const f of open) f.files.set(path, snap)
  }
  const touchTable = name => { const open = txFrames().filter(f => !f.tables.has(name)); if (!open.length) return; const snap = P.tableSnap(name, ws()); for (const f of open) f.tables.set(name, snap) }
  const rollbackFrame = (f, note) => {
    const opts = { who: ctx.who, thread: ctx.thread, note }
    for (const [path, snap] of f.files) P.revert(path, ws(), snap, opts)
    for (const [name, snap] of f.tables) P.restoreTable(name, snap, ctx.who, ws())
    return [...f.files.keys(), ...[...f.tables.keys()].map(t => 'table ' + t)]
  }
  const frameOrThrow = id => {
    const fr = id ? P.frame(id) : P.board().frames[0]
    if (!fr) throw Object.assign(new Error('no frame ' + id + '. Frames: ' + P.board().frames.map(f => f.id + ' ' + f.route).join(', ')), { kind: 'missing' })
    return fr
  }
  const frameFor = async id => {
    const fr = frameOrThrow(id)
    const vis = App.hostFor(fr.id)
    if (vis && vis.shown && vis.ws === ws() && vis.fixture === (fr.fixture || null)) { if (!vis.ready) await vis.readyP; return vis }
    return Headless.get(P, vis ? vis.route : fr.route, ws(), fr.w, fr.h, fr.fixture || null)
  }
  const frameInfo = f => { const v = App.hostFor(f.id); return { id: f.id, label: f.label || undefined, route: v ? v.route : f.route, page: v && v.route !== f.route ? f.route : undefined, w: f.w, h: f.h, x: f.x, y: f.y, fixture: f.fixture || undefined, errors: v ? v.errors : 0, issues: v ? v.issues.length : 0 } }
  const canvasLog = note => P.log({ kind: 'canvas', ws: 'main', who, thread: ctx.thread, note })
  const strip = e => { const o = { ...e }; delete o.after; delete o.files; return o }
  const MARK_KINDS = ['bookmark', 'milestone', 'decision', 'question', 'checkpoint']
  const api = {
    'files.list': prefix => ls().filter(p => !prefix || p.startsWith(prefix)).map(path => ({ path, size: rd(path).length, lines: rd(path).split('\n').length })),
    'files.read': path => readOrThrow(path),
    'files.exists': path => rd(need(path, 'path')) !== null,
    'files.lines': (path, from = 1, to) => { const ls = readOrThrow(path).split('\n'); to = Math.min(ls.length, to || from + 199); const w = String(to).length; return ls.slice(from - 1, to).map((l, i) => String(from + i).padStart(w) + '| ' + l).join('\n') },
    'files.write': (path, text) => { need(path, 'path'); writable(path); const bad = validPath(path); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' }); const created = rd(path) === null; wr(path, String(text)); return { path, created, lines: String(text).split('\n').length } },
    'files.replace': (path, find, repl, opts = {}) => {
      writable(path); const t = readOrThrow(path); need(find, 'find')
      const n = t.split(find).length - 1
      if (!n) throw Object.assign(new Error('text not found in ' + path + '; read the file and copy the exact text, whitespace included'), { kind: 'anchor' })
      if (n > 1 && !opts.all) throw Object.assign(new Error('text found ' + n + ' times in ' + path + ' (lines ' + t.split('\n').map((l, i) => l.includes(find.split('\n')[0]) ? i + 1 : 0).filter(Boolean).slice(0, 6).join(', ') + '); include more surrounding text, or pass {all: true}'), { kind: 'anchor' })
      wr(path, opts.all ? t.split(find).join(String(repl)) : t.replace(find, () => String(repl)))
      return { path, replaced: opts.all ? n : 1 }
    },
    'files.remove': path => { writable(path); readOrThrow(path); rm(path); return { path, removed: true } },
    // who last changed each run of lines, and why (the request, reply and marks of that turn)
    'files.blame': (path, o = {}) => {
      readOrThrow(path); const at = P.blame(path, ws()), lines = P.read(path, ws()).split('\n'), from = Math.max(1, +o.from || 1), to = Math.min(lines.length, +o.to || lines.length), runs = []
      for (let k = from; k <= to; k++) { const i = at[k - 1], last = runs[runs.length - 1]; if (last && last.event === i) last.to = k; else runs.push({ from: k, to: k, event: i }) }
      return runs.map(r => { const w = r.event != null ? P.why(r.event) : null; return { lines: r.from === r.to ? String(r.from) : r.from + '–' + r.to, who: !w ? 'unknown' : w.kind === 'init' ? 'template' : w.who === 'agent' ? 'claude' + (w.role ? ' (' + w.role + ')' : '') : w.who, when: w ? new Date(w.t).toISOString() : undefined, request: w && w.request || undefined, reply: w && w.reply || undefined, marks: w && w.marks && w.marks.length ? w.marks.map(m => m.kind + ': ' + m.label + (m.why ? ' (' + m.why + ')' : '')) : undefined, note: w && !w.request && w.note || undefined, proposal: w && w.proposal || undefined, thread: w && w.thread || undefined, event: r.event } })
    },
    'files.grep': (pattern, opts = {}) => {
      let re; try { re = new RegExp(need(pattern, 'pattern'), opts.flags || 'i') } catch (e) { throw Object.assign(new Error('bad regex: ' + e.message), { kind: 'invalid' }) }
      const out = []
      for (const path of ls()) { if (opts.path && !path.startsWith(opts.path)) continue; rd(path).split('\n').forEach((l, i) => { if (out.length < 200 && re.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 200) }) }) }
      return out
    },
    // data: in a proposal, the first write to a table copies it into the proposal; main's rows change only on accept
    'data.tables': () => [...P.tablesIn(ws()).values()].map(t => ({ name: t.name, cols: t.cols, count: t.rows.length, ...(ws() !== 'main' && P.ownsTable(t.name, ws()) ? { proposalCopy: true } : {}) })),
    'data.rows': (table, where) => P.rows(need(table, 'table'), where, ws()).slice(0, 300),
    'data.define': (table, cols) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.define(table, cols, who, ws()) },
    'data.insert': (table, row) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.insert(table, row, who, ws()) },
    'data.update': (table, id, patch) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.update(table, id, patch, who, ws()) },
    'data.remove': (table, id) => { writable(); noDryData(); touchTable(need(table, 'table')); return P.removeRow(table, id, who, ws()) },
    'data.drop': table => { writable(); noDryData(); touchTable(need(table, 'table')); P.dropTable(table, who, ws()); return true },
    // ---- the canvas: frames are views, so arranging them is allowed in every mode ----
    'frames.list': () => P.board().frames.map(frameInfo),
    'frames.open': (route, o = {}) => {
      need(route, 'route')
      if (o.fixture && P.read(fixturePath(o.fixture), ws()) === null) throw Object.assign(new Error('no fixture ' + fixturePath(o.fixture) + '. Fixtures: ' + (fixtureList(P, ws()).map(x => x.name).join(', ') || 'none')), { kind: 'missing' })
      const ex = !o.new && P.board().frames.find(f => (App.hostFor(f.id) ? App.hostFor(f.id).route : f.route) === route && f.w === (o.w || 375) && f.h === (o.h || 720) && (f.fixture || null) === (o.fixture || null))
      if (ex) return { ...frameInfo(ex), reused: true, note: 'a frame already shows ' + route + ' at this size; pass {new: true} for another' }
      const f = P.addFrame({ route, w: o.w || 375, h: o.h || 720, x: o.x, y: o.y }); if (o.label) f.label = String(o.label).slice(0, 60); if (o.fixture) f.fixture = String(o.fixture); P.saveMeta(); P.ev.emit('frames'); canvasLog('opened ' + route + ' ' + f.w + '×' + f.h); return frameInfo(f) },
    'frames.update': (id, o = {}) => {
      const f = frameOrThrow(need(id, 'frameId'))
      if (o.w != null) f.w = clamp(Math.round(+o.w) || f.w, 240, 2400); if (o.h != null) f.h = clamp(Math.round(+o.h) || f.h, 200, 4000)
      if (o.x != null) f.x = Math.round(+o.x) || 0; if (o.y != null) f.y = Math.round(+o.y) || 0
      if (o.label !== undefined) f.label = o.label ? String(o.label).slice(0, 60) : undefined
      if (o.route && o.route !== f.route) { const v = App.hostFor(f.id); f.route = o.route; if (v) v.navigate(o.route) }
      if (o.fixture !== undefined) {
        if (o.fixture && P.read(fixturePath(o.fixture), ws()) === null) throw Object.assign(new Error('no fixture ' + fixturePath(o.fixture)), { kind: 'missing' })
        f.fixture = o.fixture || undefined; for (const v of App.canvas ? App.canvas.hostsFor(f.id) : []) v.setFixture(f.fixture)
      }
      P.saveMeta(); P.ev.emit('frames'); return frameInfo(f)
    },
    'frames.move': (id, x, y) => api['frames.update'](id, { x, y }),
    'frames.label': (id, label) => api['frames.update'](id, { label: label || null }),
    'frames.close': id => { const f = frameOrThrow(need(id, 'frameId')); P.removeFrame(f.id); canvasLog('closed ' + (f.label || f.route)); return { closed: f.id, remaining: P.board().frames.length } },
    'frames.arrange': (rows, o = {}) => {
      if (!Array.isArray(rows) || !rows.length) throw Object.assign(new Error('rows is a list of rows, each a list of frame ids: [["f1", "f2"], ["f3"]]'), { kind: 'invalid' })
      const gap = o.gap ?? 60, rowGap = o.rowGap ?? 110
      let y = o.y ?? 0, placed = 0
      for (const row of rows) {
        let x = o.x ?? 0, hmax = 0
        for (const id of [].concat(row)) { const f = frameOrThrow(id); f.x = x; f.y = y; x += f.w + gap; hmax = Math.max(hmax, f.h); placed++ }
        y += hmax + rowGap
      }
      P.saveMeta(); P.ev.emit('frames'); canvasLog('arranged ' + plural(placed, 'frame') + ' in ' + plural(rows.length, 'row'))
      setTimeout(() => App.canvas && App.canvas.fit(), 120)
      return P.board().frames.map(frameInfo)
    },
    'frames.focus': id => { const f = id ? frameOrThrow(id) : null; setTimeout(() => App.canvas && (f ? App.canvas.focusFrame(f.id) : App.canvas.fit()), 60); return true },
    'frames.outline': async id => { const fh = await frameFor(id), nodes = await fh.call('outline', [300]); return nodes.map(n => '  '.repeat(n.d) + n.tag + (n.id ? '#' + n.id : '') + (n.cls ? '.' + n.cls : '') + (n.text ? ' "' + n.text + '"' : '') + (n.src ? '  @' + n.src : '')).join('\n') },
    'frames.inspect': async (id, target) => { const fh = await frameFor(id); const r = await fh.call('inspect', [target]); r.rules = r.rules.map(x => ({ file: x.file, selector: x.selector, media: x.media || undefined, css: x.text })); return r },
    'frames.check': async id => { const fh = await frameFor(id); const issues = await fh.call('check', [], 4000); return { route: fh.route, errors: fh.logs.filter(l => l.level === 'error').map(l => l.text + (l.src ? ' @' + l.src : '')).slice(-10), issues } },
    'frames.click': async (id, target) => { const fh = await frameFor(id); const r = await fh.call('click', [target]); await sleep(120); return r },
    'frames.type': async (id, target, text) => { const fh = await frameFor(id); return fh.call('type', [target, text]) },
    'frames.text': async (id, target) => { const fh = await frameFor(id); return fh.call('text', [target || null]) },
    'frames.query': async (id, selector) => { const fh = await frameFor(id); return fh.call('query', [need(selector, 'selector')]) },
    'frames.console': async id => { const fh = await frameFor(id); return fh.logs.slice(-30).map(l => l.level + ': ' + l.text + (l.src ? ' @' + l.src : '')) },
    'frames.reload': async id => { const fh = await frameFor(id); await fh.load({ keepState: false }); return { route: fh.route, errors: fh.errors } },
    'frames.waitFor': async (id, selector, o = {}) => { const fh = await frameFor(id), t = clamp(+o.timeout || 2000, 50, 15000); return fh.call('waitFor', [need(selector, 'selector'), t], t + 1500) },
    'frames.count': async (id, selector) => { const fh = await frameFor(id); await fh.call('settle', [600], 2000).catch(() => { }); return fh.call('count', [need(selector, 'selector')]) },
    'frames.layout': async (id, o = {}) => {
      const fh = await frameFor(id), L = await fh.call('layout', [], 5000)
      let items = L.items
      if (o.near) { const q = String(o.near); items = items.filter(i => (i.s || '').startsWith(q) || i.k.includes(q) || i.t.includes(q) || (i.x || '').includes(q)) }
      return { route: fh.route, width: L.w, height: L.h, count: L.items.length, items: items.slice(0, 150).map(i => ({ key: i.k, tag: i.t, box: i.b, text: i.x, src: i.s, hidden: i.hid ? true : undefined })) }
    },
    'frames.snapshot': async (id, label) => { const fh = await frameFor(id), m = await Snaps.take(P, fh, { label: label || null, by: who }); if (!m) throw new Error('snapshot too large'); return { id: m.id, route: m.route, w: m.w, ws: m.ws, label: m.label, t: new Date(m.t).toISOString() } },
    // layout differences: this workspace against another (default: main, or the newest snapshot when in main), or a snapshot id
    'frames.compare': async (id, o = {}) => {
      const fr0 = frameOrThrow(need(id, 'frameId')), v0 = App.hostFor(fr0.id), fr = { ...fr0, route: v0 ? v0.route : fr0.route }, cur = await layoutIn(P, fr, ws(), { headless: true })
      let other, what = o.with
      if (!what) { if (ws() !== 'main') what = 'main'; else { const s = Snaps.list(P).filter(x => x.route === cur.fh.route && x.w === fr.w && x.ws === 'main').slice(-1)[0]; if (!s) throw Object.assign(new Error('nothing to compare with: in main, take a snapshot first (frames.snapshot) or pass {with: proposalId}'), { kind: 'missing' }); what = s.id } }
      if (/^sn/.test(what)) { const d = await Snaps.load(P, what); if (!d) throw Object.assign(new Error('no snapshot ' + what), { kind: 'missing' }); other = d.layout }
      else { if (what !== 'main' && !P.overlays.get(what)) throw Object.assign(new Error('no workspace ' + what + ' (main or a proposal id)'), { kind: 'missing' }); other = (await layoutIn(P, fr, what, { headless: true })).layout }
      const d = layoutDiff(other, cur.layout)
      return { frame: cur.fh.route + ' ' + fr.w + 'px', from: what, to: ws(), changes: d.changes.length, summary: diffSummary(d, 30) }
    },
    'frames.data': async id => { const fh = await frameFor(id); return fh.fx ? { fixture: fh.fixture, tables: Object.fromEntries(Object.entries(fh.fx.tables).map(([n, t]) => [n, t.rows.length])), store: fh.fx.store, clock: fh.fx.clock } : { fixture: null, note: 'this frame uses the live data of ' + ws() } },
    'snapshots.list': (o = {}) => Snaps.list(P).filter(s => !o.route || s.route === o.route).slice(-40).map(s => ({ id: s.id, route: s.route, w: s.w, ws: s.ws, label: s.label || undefined, note: s.note, fixture: s.fixture || undefined, t: new Date(s.t).toISOString() })),
    // ---- fixtures and scenarios are files (fixtures/*.json, scenarios/*.json): staged in proposals, reviewed like code ----
    'fixtures.list': () => fixtureList(P, ws()).map(f => ({ name: f.name, description: f.description || undefined, tables: f.tables, clock: f.clock || undefined, error: f.error || undefined })),
    'fixtures.save': (name, spec) => {
      writable('fixtures/'); const bad = checkFixture(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
      const path = fixturePath(need(name, 'name').replace(/[^\w-]/g, '-')); wr(path, JSON.stringify(spec, null, 2) + '\n', 'fixture'); return { path }
    },
    'fixtures.capture': (name, o = {}) => {
      writable('fixtures/'); const tabs = P.tablesIn(ws()), want = o.tables || [...tabs.keys()], tables = {}
      for (const n of want) { const t = tabs.get(n); if (!t) throw Object.assign(new Error('no table ' + n), { kind: 'missing' }); tables[n] = clone(t.rows) }
      return api['fixtures.save'](name, { description: o.description || 'captured from ' + ws() + ' data', tables, ...(o.clock ? { clock: o.clock } : {}) })
    },
    'scenarios.list': () => scenarioList(P, ws()).map(s => ({ name: s.name, description: s.spec && s.spec.description || undefined, page: s.spec && s.spec.page, steps: s.spec && s.spec.steps ? s.spec.steps.length : 0, fixture: s.spec && s.spec.fixture || undefined, error: s.error || undefined, last: s.last ? (s.last.ok ? 'passed' : 'failed at step ' + (s.last.failedAt + 1)) : undefined })),
    'scenarios.read': name => { const s = scenarioList(P, ws()).find(x => x.name === name); if (!s) throw Object.assign(new Error('no scenario ' + name + '. Scenarios: ' + scenarioList(P, ws()).map(x => x.name).join(', ')), { kind: 'missing' }); return s.spec },
    'scenarios.save': (name, spec) => {
      writable('scenarios/'); const bad = checkScenario(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
      const path = SCEN_DIR + need(name, 'name').replace(/[^\w-]/g, '-') + '.json'; wr(path, JSON.stringify(spec, null, 2) + '\n', 'scenario'); return { path, steps: spec.steps.length }
    },
    'scenarios.run': async target => {
      let spec = target, name = 'unsaved'
      if (typeof target === 'string') { name = target; spec = api['scenarios.read'](target) }
      const r = await runScenario(P, spec, { ws: ws(), name, who, thread: ctx.thread, signal: ctx.signal })
      return { name, ok: r.ok, ms: r.ms, failedAt: r.ok ? undefined : r.failedAt + 1, steps: r.steps.map(s => (s.ok ? '✓ ' : '✗ ') + s.label + (s.error ? ': ' + s.error : '') + (s.errors ? ' [console: ' + s.errors.join('; ') + ']' : '')), snapshots: r.snaps.map(s => s.id) }
    },
    'scenarios.runAll': async () => { const rs = await runAllScenarios(P, { ws: ws(), who, thread: ctx.thread, signal: ctx.signal }); return { passed: rs.filter(r => r.ok).length, failed: rs.filter(r => !r.ok).length, results: rs.map(r => (r.ok ? '✓ ' : '✗ ') + r.name + (r.error ? ' (step ' + ((r.failedAt ?? -1) + 1) + '): ' + r.error : '')) } },
    // ---- panels: controls and live widgets shown in the reply (or the Panels tab), see the guide ----
    'ui.panel': (id, spec) => {
      need(id, 'id'); if (!/^[\w-]{1,40}$/.test(id)) throw Object.assign(new Error('panel ids are words: letters, digits, _ or -'), { kind: 'invalid' })
      const p = Panels.upsert(P, id, spec, { by: who === 'agent' ? 'agent' : 'you', thread: ctx.thread, ws: ws(), pinned: ctx.onPanel ? undefined : true })
      if (ctx.onPanel) ctx.onPanel(id); else setTimeout(() => Dock.open('panels'), 50)
      return { id, shown: ctx.onPanel ? 'in your reply' : 'in the Panels tab', values: p.values }
    },
    'ui.values': id => { const p = Panels.get(P, need(id, 'id')); if (!p) throw Object.assign(new Error('no panel ' + id + '. Panels: ' + Panels.list(P).map(x => x.id).join(', ')), { kind: 'missing' }); return { ...p.values, changed: (p.log || []).filter(l => l.by === 'you').slice(-8).map(l => l.id + ' → ' + JSON.stringify(l.v)) } },
    'ui.set': (id, cid, value) => { const p = Panels.get(P, need(id, 'id')); if (!p) throw Object.assign(new Error('no panel ' + id), { kind: 'missing' }); Panels.set(P, p, need(cid, 'controlId'), value, { by: who }); return p.values },
    // show a panel and wait until the person presses Done; resolves to its values (Cancel: an approval error)
    'ui.ask': async (id, spec, o = {}) => {
      need(id, 'id')
      if (spec) api['ui.panel'](id, spec); else if (!Panels.get(P, id)) throw Object.assign(new Error('no panel ' + id + ': pass a spec'), { kind: 'missing' })
      else if (ctx.onPanel) ctx.onPanel(id)
      const v = await new Promise(resolve => { Panels.waiting.set(id, { resolve, label: o.label }); App.ev.emit('ask', id); if (ctx.signal) ctx.signal.addEventListener('abort', () => resolve(null)) })
      Panels.waiting.delete(id); App.ev.emit('ask', id)
      if (!v) throw Object.assign(new Error('the person cancelled the panel'), { kind: 'approval' })
      return v
    },
    'ui.panels': () => Panels.list(P).map(p => ({ id: p.id, title: p.spec.title, values: p.values, pinned: p.pinned, items: p.spec.items.map(i => i.id ? i.type + ' ' + i.id : i.type) })),
    'ui.closePanel': id => { Panels.remove(P, need(id, 'id')); return true },
    'ui.selection': () => App.sel ? { ...App.sel, rect: undefined } : null,
    'ui.pins': (opts = {}) => (P.meta.pins || []).filter(p => opts.all || !p.resolved).map(p => ({ id: p.id, n: p.n, route: p.route, src: p.src, text: p.text, by: p.by, resolved: !!p.resolved })),
    'ui.resolvePin': (id, note) => { const p = (P.meta.pins || []).find(x => x.id === id || x.n === id); if (!p) throw Object.assign(new Error('no pin ' + id), { kind: 'missing' }); p.resolved = true; p.reply = note || ''; P.saveMeta(); App.ev.emit('pins'); return true },
    'ui.notify': text => { toast(String(text).slice(0, 200)); return true },
    'session.mark': (label, o) => {
      const opts = typeof o === 'string' ? { why: o } : (o || {})
      if (opts.kind && !MARK_KINDS.includes(opts.kind)) throw Object.assign(new Error('mark kinds: ' + MARK_KINDS.join(', ')), { kind: 'invalid' })
      const e = P.mark({ label: need(label, 'label'), note: opts.why || opts.note, by: who, thread: ctx.thread, kind: opts.kind })
      return { i: e.i, kind: e.mk }
    },
    'session.marks': () => P.marks().map(e => ({ i: e.i, label: e.label, kind: e.mk || 'bookmark', by: e.who, why: e.note, t: new Date(e.t).toISOString() })),
    'session.events': (opts = {}) => P.events.filter(e => (!opts.kind || e.kind === opts.kind) && (!opts.path || e.path === opts.path) && (opts.since == null || e.i > opts.since)).slice(-(opts.limit || 40)).map(strip),
    'session.diff': since => {
      const i = typeof since === 'number' ? since : (P.marks().reverse().find(m => m.label === since) || {}).i
      if (i == null) throw Object.assign(new Error('pass an event index or a mark label'), { kind: 'invalid' })
      return P.since(i).map(c => diffText(c.path, c.before, c.after)).join('\n\n') || 'no changes in main since then'
    },
    // the full history behind the summary: search it, read one message
    'session.recall': (query, o = {}) => {
      const words = String(need(query, 'query')).toLowerCase().split(/[^\p{L}\p{N}_.#-]+/u).filter(w => w.length > 1)
      const own = ctx.thread && P.threads.get(ctx.thread), ths = o.thread ? [P.threads.get(o.thread)].filter(Boolean) : own && !o.all ? [own] : [...P.threads.values()]
      if (!words.length) throw Object.assign(new Error('give a few words to look for'), { kind: 'invalid' })
      const hits = []
      for (const t of ths) t.msgs.forEach((m, i) => {
        if (t === own && i >= t.msgs.length - 2) return
        const body = [m.text || '', ...(m.steps || []).flatMap(s => [s.code || '', s.out || ''])].join('\n'), low = body.toLowerCase()
        const found = words.filter(w => low.includes(w)); if (!found.length) return
        const at = low.indexOf(found[0]), a = Math.max(0, at - 90)
        hits.push({ thread: t === own ? undefined : t.title, threadId: t === own ? undefined : t.id, n: i + 1, role: m.role === 'user' ? (m.from ? 'main agent' : 'person') : 'claude', when: new Date(m.t).toISOString(), score: found.length / words.length, summarized: !!(t.summary && i < t.summary.upTo), text: (a ? '…' : '') + body.slice(a, at + 160).replace(/\s+/g, ' ') + '…' })
      })
      return hits.sort((x, y) => y.score - x.score || y.when.localeCompare(x.when)).slice(0, clamp(+o.limit || 8, 1, 30))
    },
    // events as they happen: project events (writes, data, marks, scenarios, …) and what happens in canvas frames
    'session.stream': (o = {}) => Streams.merged(P, o).map(e => ({ ...e, when: new Date(e.t).toISOString() })),
    'session.waitFor': (kind, o = {}) => new Promise((resolve, reject) => {
      const kinds = [].concat(need(kind, 'kind')), timeout = clamp(+o.timeout || 30000, 500, 300000), t0 = now()
      const ok = e => kinds.includes(e.kind) && (!o.frame || e.frame === o.frame || e.fid === o.frame) && (!o.match || JSON.stringify(e).toLowerCase().includes(String(o.match).toLowerCase()))
      const done = (v, err) => { offs.forEach(f => f()); clearTimeout(timer); err ? reject(err) : resolve(v) }
      const offs = [App.ev.on('frameevent', e => { if (ok(e)) done({ source: 'frame', kind: e.kind, frame: e.frame + ' ' + e.w + 'px', detail: e.detail, when: new Date(e.t).toISOString(), waited: now() - t0 }) }),
        App.ev.on('events', e => { if (e && e.t >= t0 && ok({ ...e, detail: e.label || e.note || e.path || '' })) done({ source: 'project', kind: e.kind, who: e.who === 'agent' ? 'claude' : e.who, path: e.path, table: e.table, detail: e.label || e.note || '', when: new Date(e.t).toISOString(), waited: now() - t0 }) })]
      const timer = setTimeout(() => done(null, Object.assign(new Error('no ' + kinds.join(' or ') + ' event within ' + timeout + ' ms'), { kind: 'timeout' })), timeout)
      if (ctx.signal) ctx.signal.addEventListener('abort', () => done(null, Object.assign(new Error('cancelled'), { kind: 'cancelled' })))
    }),
    'session.message': (n, o = {}) => {
      const t = o.thread ? P.threads.get(o.thread) : ctx.thread && P.threads.get(ctx.thread)
      if (!t) throw Object.assign(new Error('pass {thread: id} (from session.recall) outside a thread'), { kind: 'invalid' })
      const m = t.msgs[(+n || 0) - 1]; if (!m) throw Object.assign(new Error('no message ' + n + ' (the thread has ' + t.msgs.length + ')'), { kind: 'missing' })
      return { n: +n, role: m.role === 'user' ? (m.from ? 'main agent' : 'person') : 'claude', when: new Date(m.t).toISOString(), text: m.text || '', evals: (m.steps || []).map(s => ({ code: trunc(s.code || '', 2000), status: s.status, result: trunc(s.out || '', 1500), effects: effectsLine(s.effects) || undefined })) }
    },
    'session.workspace': () => ({ ws: ws(), title: ws() === 'main' ? 'main' : (P.overlays.get(ws()) || {}).title, changes: ws() === 'main' ? [] : P.changes(ws()).map(c => c.path) }),
    // lib.def arrives already checked by the sandbox (free variables, compiles alone); this writes the file
    'lib.def': (name, source, opts = {}, params = []) => {
      writable()
      const path = LIB_DIR + name + '.js', existed = rd(path) !== null
      const head = { name, description: String(opts.description || '').slice(0, 200), params, by: who, t: now() }
      const text = '// lib.' + name + (head.description ? ': ' + head.description : '') + '\n// @lib ' + JSON.stringify(head) + '\n// Saved with lib.def; rebuilt by running the source below. It may use the host API and other lib functions.\nexport default ' + source + '\n'
      wr(path, text, (existed ? 'updated' : 'saved') + ' lib.' + name)
      return { saved: 'lib.' + name, path, params, replaced: existed }
    },
    'lib.list': () => libEntries(P, ws()).map(l => ({ name: l.name, params: l.params, description: l.description, path: l.path })),
    'lib.remove': name => { writable(); const path = LIB_DIR + need(name, 'name') + '.js'; readOrThrow(path); rm(path); return { removed: 'lib.' + name } },
    'lib.source': name => readOrThrow(LIB_DIR + need(name, 'name') + '.js'),
    'log': (...a) => { ctx.logs && ctx.logs.push(a.join(' ')); return true },
    'tx.begin': () => { (ctx.txStack = ctx.txStack || []).push({ files: new Map(), tables: new Map() }); return ctx.txStack.length },
    'tx.commit': () => { (ctx.txStack || []).pop(); return true },
    'tx.rollback': () => { const f = (ctx.txStack || []).pop(); return f ? rollbackFrame(f, 'rolled back: an atomic step failed') : [] },
    'dry.begin': () => { if (ctx.scratch) throw Object.assign(new Error('a dry run is already open'), { kind: 'invalid' }); ctx.scratch = { files: new Map() }; return true },
    'dry.end': () => {
      const sc = ctx.scratch; ctx.scratch = null
      const files = [], diffs = []
      for (const [path, text] of sc ? sc.files : []) {
        const cur = P.read(path, ws()); if (cur === text) continue
        files.push(cur === null ? { path, change: 'create', lines: text.split('\n').length } : text === null ? { path, change: 'remove' } : { path, change: 'edit', ...diffStat(cur, text) })
        diffs.push(diffText(path, cur, text))
      }
      const id = uid('cs'); (ctx.dryStore = ctx.dryStore || new Map()).set(id, sc ? sc.files : new Map())
      return { id, files, diff: trunc(diffs.join('\n\n'), 8000) }
    },
    'dry.apply': (id, paths) => {
      writable(); const files = ctx.dryStore && ctx.dryStore.get(id); if (!files) throw Object.assign(new Error('no changeset ' + id + ' (changesets last for the turn)'), { kind: 'missing' })
      let n = 0
      for (const [path, text] of files) { if (paths && !paths.includes(path)) continue; if (text === null) { if (rd(path) !== null) { rm(path); n++ } } else if (rd(path) !== text) { wr(path, text, 'applied a dry run'); n++ } }
      return { applied: n }
    },
    'dry.discard': id => { ctx.dryStore && ctx.dryStore.delete(id); return true },
    'ui.approve': (title, detail) => approvalCard(ctx, String(title), detail ? String(detail) : ''),
    'ui.pin': async (id, target, text) => {
      const fh = await frameFor(need(id, 'frameId'))
      const sel = typeof target === 'string' ? target : target && target.src ? '[data-src="' + target.src + '"]' : null
      const hit = sel ? (await fh.call('query', [sel, 1]))[0] : null
      if (sel && !hit) throw Object.assign(new Error('no element matches ' + sel + ' in ' + fh.route), { kind: 'missing' })
      const n = (P.meta.pins || []).reduce((a, p) => Math.max(a, p.n), 0) + 1
      P.meta.pins.push({ id: 'pin' + uid(), n, route: fh.route, src: hit ? hit.src : '', selector: hit ? hit.selector : '', rx: 0.5, ry: 0.5, text: need(text, 'text').slice(0, 500), by: ctx.role ? 'Claude · ' + ctx.role : who === 'agent' ? 'Claude' : 'you', t: now(), resolved: false })
      P.saveMeta(); P.log({ kind: 'pin', who, ws: 'main', thread: ctx.thread, note: '#' + n + ' ' + text.slice(0, 100), path: hit && hit.src ? hit.src.split(':')[0] : undefined }); App.ev.emit('pins')
      return { pin: n, route: fh.route, src: hit ? hit.src : null }
    },
    'llm': async (prompt, o = {}) => {
      if (!Agent.sample) throw Object.assign(new Error('Claude is not available in this view'), { kind: 'unavailable' })
      ctx.llmCalls = (ctx.llmCalls || 0) + 1
      if (ctx.llmCalls > 24) throw Object.assign(new Error('llm calls are capped at 24 per turn'), { kind: 'budget' })
      let res
      try { res = await Agent.sample(String(prompt) + (o.output ? '\n\nReply with JSON only, no prose and no code fences, matching: ' + o.output : ''), { modelTier: o.tier || 'quick', cache: false, signal: ctx.signal }) }
      catch (e) { throw Object.assign(new Error(e && e.message || String(e)), { kind: e && e.code === 'rate_limited' ? 'rate_limited' : 'llm' }) }
      const text = (res && res.text || '').trim()
      if (!o.output) return text
      const v = parseJSONReply(text); if (v === undefined) throw Object.assign(new Error('the reply was not JSON: ' + text.slice(0, 200)), { kind: 'llm' })
      return v
    },
    'agents.delegate': (role, task, o = {}) => Agent.delegate(ctx, role, need(task, 'task'), o),
    'agents.roles': () => Object.entries(ROLES).map(([name, r]) => ({ name, describe: r.describe, writes: r.mode === 'read' ? false : r.mode === 'tests' ? 'scenarios/ and fixtures/ only' : true, evals: r.evals }))
  }
  return api
}
function parseJSONReply(text) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
  try { return JSON.parse(t) } catch { }
  for (const [o, c] of [['{', '}'], ['[', ']']]) { const i = t.lastIndexOf(o === '{' ? '\n{' : '\n['), a = i >= 0 ? i + 1 : t.indexOf(o), b = t.lastIndexOf(c); if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)) } catch { } } }
  return undefined
}
// an approval asked from inside an eval (step.approve()): a card in the thread, or a dialog from the Eval panel
function approvalCard(ctx, title, detail) {
  return new Promise(resolve => {
    const done = v => { resolve(v); if (ctx.onApproval) ctx.onApproval(null) }
    if (ctx.onApproval) { ctx.onApproval({ title, detail, decide: done }); if (ctx.signal) ctx.signal.addEventListener('abort', () => done(false)); return }
    let answered = false
    modal({ title, body: [h('p.note', 'Code in the sandbox asks before it continues.'), detail ? h('pre.mono', { style: { whiteSpace: 'pre-wrap', fontSize: '11px', maxHeight: '300px', overflow: 'auto', margin: 0 } }, detail) : null],
      onClose: () => { if (!answered) resolve(false) }, actions: [{ label: 'Decline', run: () => { answered = true; resolve(false) } }, { label: 'Approve', primary: true, run: () => { answered = true; resolve(true) } }] })
  })
}

// ---------- one eval, with its transaction and its effects ----------
// Both the agent and the Eval panel go through this: writes roll back if the eval fails, and the result says
// what changed: files written, check issues that appeared or went away, new console errors.
async function runEval(ctx, code, api, { sid, restore } = {}) {
  const P = ctx.project, ws = ctx.ws
  const before = new Map(), layouts = new Map()
  for (const f of P.board().frames) { const v = App.hostFor(f.id); if (v && v.ws === ws && v.ready) before.set(f.id, new Set(v.issues.map(issueKey(v)))) }
  // each frame's layout before the eval, to report what its writes did to the pages
  await Promise.all(P.board().frames.map(async f => {
    const v = App.hostFor(f.id), fh = v && v.shown && v.ws === ws && v.fixture === (f.fixture || null) ? v : Headless.peek(P, v ? v.route : f.route, ws, f.w, f.h, f.fixture || null)
    if (!fh || !fh.ready) return
    try { layouts.set(f.id, { route: fh.route, layout: await fh.call('layout', [300], 1200) }) } catch { if (fh.layoutMap) layouts.set(f.id, { route: fh.route, layout: fh.layoutMap }) }
  }))
  ctx.tx = { files: new Map(), tables: new Map(), t0: now() }
  // An app project's writes reach draft (and its dev instance runs them)
  // only once the eval has committed: held until then, and a rollback
  // leaves nothing to push.
  const held = !!(P.meta.app && ws === 'main')
  if (held) Sync.hold()
  let r, tx
  const effects = {}
  try {
    r = await Sandbox.run(code, api, { sid, restore, lib: libEntries(P, ws).map(l => ({ name: l.name, source: l.source })) })
  } finally {
    tx = ctx.tx; ctx.tx = null; ctx.scratch = null; ctx.txStack = []
    if (!r || (!r.ok && (tx.files.size || tx.tables.size))) {
      const opts = { who: ctx.who, thread: ctx.thread, note: 'rolled back: the eval failed' }
      for (const [path, snap] of tx.files) P.revert(path, ws, snap, opts)
      for (const [name, snap] of tx.tables) P.restoreTable(name, snap, ctx.who, ws)
      effects.rolledBack = [...tx.files.keys(), ...[...tx.tables.keys()].map(t => 'table ' + t)]
    }
    if (held) Sync.release()
  }
  if (!effects.rolledBack) {
    const files = []
    for (const [path, snap] of tx.files) {
      const cur = P.read(path, ws); if (cur === snap.text) continue
      files.push(snap.text === null ? { path, change: 'created', lines: cur.split('\n').length } : cur === null ? { path, change: 'removed' } : { path, change: 'edited', ...diffStat(snap.text, cur) })
    }
    if (files.length) effects.files = files
    if (tx.tables.size) effects.tables = [...tx.tables.keys()]
  }
  // An app project on slop: the writes go to draft now; the dev instance
  // comes up on them (or says why not) and its frames reload before the
  // frames are measured. Its new warnings and errors are effects too.
  if (r.ok && tx.files.size && P.meta.app && ws === 'main' && Slop.on) {
    const s = await Sync.flush(P)
    if (s.error) effects.push = { error: s.error }
    else {
      effects.draft = s.n
      if (s.act) effects.actor = s.act.broken ? { broken: s.act.broken, on: s.act.n } : { on: s.act.n }
      const want = s.act && !s.act.broken ? s.act.n : null
      await Promise.all([...FrameHosts].filter(fh => fh.project === P && fh.embed).map(fh => fh.waitVersion(want)))
    }
    if (Embeds.ready.has(P.meta.app)) {
      const l = await Outside.logs(P).catch(() => null)
      const bad = l ? (l.lines || []).filter(x => x.at >= tx.t0 && (x.level === 'error' || x.level === 'warn')).map(x => x.level + ': ' + x.text) : []
      if (bad.length) effects.actorLogs = bad.slice(-6)
    }
  }
  if (tx.files.size || tx.tables.size) Object.assign(effects, await frameEffects(ctx, before, tx.t0, layouts))
  r.effects = Object.keys(effects).length ? effects : null
  return r
}
const issueKey = fh => i => fh.route + ' ' + fh.w + 'px|' + i.kind + '|' + (i.src || i.selector)
async function frameEffects(ctx, before, t0, layouts = new Map()) {
  const P = ctx.project, ws = ctx.ws, added = [], fixed = [], errors = new Set(), layout = []
  await sleep(260)                       // let the reloads the writes scheduled begin
  for (const f of P.board().frames) {
    let fh = App.hostFor(f.id)
    try { if (!fh || !fh.shown || fh.ws !== ws || fh.fixture !== (f.fixture || null)) fh = await Headless.get(P, fh ? fh.route : f.route, ws, f.w, f.h, f.fixture || null); await fh.runCheck() } catch { continue }
    const lb = layouts.get(f.id)
    if (lb && lb.route === fh.route && fh.layoutMap && !layout.some(x => x.frame === fh.route + ' ' + fh.w + 'px')) {
      const d = layoutDiff(lb.layout, fh.layoutMap)
      if (d.changes.length || Math.abs(d.heightFrom - d.heightTo) > 1) layout.push({ frame: fh.route + ' ' + fh.w + 'px', changes: diffSummary(d, 10) })
    }
    const key = issueKey(fh), now = new Set(fh.issues.map(key)), was = before.get(f.id)
    if (was) { for (const i of fh.issues) if (!was.has(key(i))) added.push({ frame: fh.route + ' ' + fh.w + 'px', kind: i.kind, message: i.message, src: i.src || undefined }); for (const k of was) if (!now.has(k)) fixed.push(k.split('|').slice(0, 2).join(' · ')) }
    for (const l of fh.logs) if (l.level === 'error' && l.t >= t0) errors.add(fh.route + ': ' + l.text + (l.src ? ' @' + l.src : ''))
  }
  const out = {}
  if (added.length) out.newIssues = added.slice(0, 8)
  if (fixed.length) out.fixedIssues = [...new Set(fixed)].slice(0, 8)
  if (errors.size) out.newErrors = [...errors].slice(0, 6)
  if (layout.length) out.layout = layout.slice(0, 5)
  return out
}
function effectsLine(e) {
  if (!e) return ''
  const parts = []
  if (e.rolledBack) parts.push('rolled back ' + e.rolledBack.join(', '))
  for (const f of e.files || []) parts.push(f.change === 'edited' ? f.path + ' +' + f.add + ' −' + f.del : f.change + ' ' + f.path)
  if (e.tables) parts.push('tables ' + e.tables.join(', '))
  if (e.push) parts.push('push to draft failed: ' + e.push.error.slice(0, 100))
  if (e.draft != null) parts.push('draft ' + e.draft + (e.actor ? e.actor.broken ? ' · dev instance stays on ' + e.actor.on + ': ' + e.actor.broken.slice(0, 120) : ' · dev ok' : ''))
  if (e.actorLogs) parts.push(plural(e.actorLogs.length, 'actor warning') + '/errors')
  if (e.fixedIssues) parts.push('fixed ' + plural(e.fixedIssues.length, 'issue'))
  if (e.newIssues) parts.push(plural(e.newIssues.length, 'new issue'))
  if (e.newErrors) parts.push(plural(e.newErrors.length, 'new error'))
  if (e.layout) parts.push('layout changed on ' + e.layout.map(l => l.frame.split(' ')[0]).filter((x, i, a) => a.indexOf(x) === i).join(', '))
  return parts.join(' · ')
}
function scopeSummary(scope) {
  if (!scope || !scope.vars) return ''
  const k = v => v === null ? 'null' : Array.isArray(v) ? 'array(' + v.length + ')' : typeof v === 'object' ? 'object' : typeof v
  return Object.entries(scope.vars).map(([n, v]) => n + ': ' + k(v)).join(', ')
}

const API_GUIDE = `You are the coding agent inside Sitebench, an IDE where a person builds real websites (HTML, CSS, JS files plus small data tables) and watches them run live in frames on a canvas.

You act through ONE tool, eval. Each call runs a JavaScript async function body in a QuickJS sandbox: no DOM, no network, no window. Use await, and \`return\` the value you want back (the last expression is not returned automatically). console.log output comes back too.

Your evals share a scope: top-level \`const\`/\`let\`/\`function\`/\`class\` declarations persist to your later evals in this thread (and across reloads, if they are JSON). Read once, keep the result in a variable, use it next time. vars() lists them; forget('name') drops one, forget() all. Names of the API stay local.
An eval is a transaction: if it throws, its file and table writes are rolled back. The result carries \`effects\`: files written (+added −removed lines), check issues that appeared or were fixed in every frame, new console errors, and \`layout\`: what moved, resized, appeared or changed text on each frame's page ("page height 900 → 1020", "div.cats @menu.html:12: size 343×34 → 343×76").
Save reusable helpers with lib.def(name, fn, {description}) (→ .agent/lib/<name>.js, reviewed like any file); later evals, threads and sessions call lib.<name>(...). A saved function is rebuilt from its source alone: it may use the API, its arguments and other lib functions, not your variables. lib.list(), lib.source(name), lib.remove(name).

Steps. Every module verb returns a Step: a plan. Awaiting a step runs it, so \`await files.read(p)\` just works. Steps also compose before they run:
  a.then(b) or seq(a, b)          b gets a's output; a function is wrapped as step(fn): (input, { input: runInput }) => value
  par([a, b]) or par({ k: a })    same input to each branch, outputs in an array or object
  alt({ k: a, other: b }).by(x => key)       one branch per input      loop(body).seed(s).until(st => …).max(n).keep('best', st => score)
  .map({ concurrency }) runs a step once per element of an array input; .fold(monoid.sum | (acc, v) => …, init)
  dyn(async (x, ctx) => ctx.run(term, input))   shape decided at run time       tx(async () => { … })  everything inside is atomic
  A verb missing its first argument takes it from the input: files.list().then(step(fs => fs.filter(f => f.path.endsWith('.css')))).then(files.read().map())
  Wrappers: .retry({ times, when: e => e.kind === 'anchor' }) .timeout('30s') .fallback(other) .guard(x => …, msg) .verify(out => …, msg) .tap(fn) .approve('title') (asks the person) .named(name) .atomic() (undo every write inside if anything inside fails)
  .explain() returns the plan without running it. await step.dry() runs it with file writes captured and returns a changeset { files, diff }: await cs.apply() (or cs.only(f => …).apply()).
  llm\`question about ${'${x => x.text}'}\`.output(s.enum(['yes', 'no'])) asks a quick model once. Schemas: s.string() s.number() s.int() s.boolean() s.enum([…]) s.array(item) s.object({ … }), .optional() .describe(text).
  Error kinds (e.kind): anchor (replace text not found or ambiguous), missing, invalid, type, timeout, guard, verify, schema, policy, approval, budget. retry and fallback never catch policy, approval, budget or cancelled.
  help() lists everything; help(files.replace) shows one verb.

Subagents. delegate(role, task, { output, evals, proposal }) runs another Claude with its own thread, sandbox and timeline lane, and returns { result, thread, evals, proposal?, changes? }. Its evals come out of your budget; depth is capped at 2. Roles:
  explorer  read-only investigation, answers with file:line evidence
  reviewer  reads a proposal's diff and checks its frames; result { verdict: 'approve' | 'changes', comments }  (pass { proposal: id }, default: your own proposal)
  qa        sweeps frames for overflow, contrast, a11y and errors, files a pin per problem; result { pins, summary }
  builder   builds in a proposal of its own and summarizes; result has proposal and changes
  delegate is a step, so it fans out: await par(['editorial', 'playful'].map(d => delegate('builder', brief + ' Direction: ' + d)))
  Pass { output: s.object({ … }) } to get typed JSON back. Delegate when work splits cleanly or needs a second opinion; do small things yourself.

Host API verbs (each returns a Step; await it to run):
files.list(prefix?) -> [{path, size, lines}]
files.read(path) -> text            files.lines(path, from=1, to?) -> numbered lines "12| ..."
files.exists(path) -> bool
files.write(path, text)             (creates or replaces the whole file)
files.replace(path, find, replacement, {all}?)  exact-text edit; error kind anchor if not found or ambiguous
files.remove(path)                  files.grep(regex, {path?, flags?}) -> [{path, line, text}]
files.blame(path, {from, to}?) -> runs of lines with who last changed them, when, and why: the request, reply and marks of that turn (look before undoing someone's change)
data.tables() -> [{name, cols, count}]     data.rows(table, where?) -> rows
data.define(table, cols)   data.insert(table, row) -> row with id   data.update(table, id, patch)   data.remove(table, id)
frames.list() -> [{id, label, route, w, h, x, y, errors, issues}]   frames.open(route, {w, h, x, y, label, fixture, new}?) -> frame (reuses one showing that route at that size unless new: true)
frames.update(frameId, {route, w, h, x, y, label})   frames.move(frameId, x, y)   frames.label(frameId, text)   frames.close(frameId)
frames.arrange([[id, id, ...], [id, ...]], {gap, rowGap}?)  lay frames out in rows, left to right, then fits the view   frames.focus(frameId?)
  (canvas layout is a view: arranging, labelling and closing frames is allowed in every mode)
frames.check(frameId?) -> {errors, issues}   (layout overflow, contrast, a11y, console errors)
frames.outline(frameId?) -> indented DOM tree with @file:line for each element
frames.inspect(frameId, target) -> box, computed styles, matched CSS rules with their files
frames.query(frameId, selector) -> matches     frames.text(frameId, target?) -> visible text
frames.click(frameId, target)   frames.type(frameId, target, text)   frames.console(frameId)   frames.reload(frameId)
  target is a CSS selector string or {src: "file.html:12"}; a selector may end in :has-text("words") (e.g. 'button:has-text("Add")')
  query and the other reads wait until the page has settled (data loaded, DOM quiet). frames.waitFor(frameId, selector, {timeout}?) waits for a visible match
  frames.count(frameId, selector) -> number. Each match from frames.query has attrs (data-*, href, name, value, checked, aria-*)
frames.layout(frameId?, {near}?) -> every rendered element: key, tag, box [x, y, w, h], own text, src
frames.compare(frameId, {with}?) -> layout differences: this workspace against main (from a proposal), or against a snapshot id
frames.snapshot(frameId?, label?) -> a frozen copy of the page and its layout     snapshots.list({route}?)
frames.data(frameId?) -> which data the frame runs on (fixture tables, store, clock)
Fixtures (fixtures/<name>.json) are fixed data a frame or a scenario runs on instead of the live tables: { description, tables: { menu: [rows] | "live" }, store?: {}, clock?: "2026-05-01T08:30" }
  fixtures.list()   fixtures.save(name, spec)   fixtures.capture(name, {tables, clock}?) copies the current rows   frames.open(route, {fixture}) / frames.update(id, {fixture: name | null})
Scenarios (scenarios/<name>.json) are flows that run in a frame of their own, on a copy of the data (or a fixture), and pass or fail:
  { description, page: "menu.html", size?: [375, 720], fixture?: name, steps: [
    { click: sel }, { type: sel, text }, { go: "cart.html" }, { waitFor: sel }, { wait: ms },
    { expect: sel } (visible) | { expect: sel, text } (contains) | { expect: sel, count } | { expect: sel, visible: false } | { expect: sel, value },
    { data: table, where?, count? }, { store: key, count? | equals? }, { snapshot: label } ] }
  Checks retry until they pass or time out ({ timeout } on a step or the scenario, default 2000 ms). A failure keeps a snapshot.
  scenarios.list()   scenarios.read(name)   scenarios.save(name, spec)   scenarios.run(nameOrSpec) -> { ok, failedAt, steps: ["✓ …", "✗ …: why"] }   scenarios.runAll()
ui.selection() -> what the person selected on the canvas (has src "file:line")
Panels: small UIs you show in your reply, to let the person tune things live or to show live numbers.
  ui.panel(id, { title, description?, items: [ … ] }) creates or updates one (same id = same panel; values the person set are kept)
  controls: { type: 'slider', id, label, min, max, step?, value?, unit? } | { type: 'toggle', id, label } | { type: 'select', id, options: [v | {value, label}] } | { type: 'text', id } | { type: 'color', id }
    bind (optional) makes a control act on the pages:
      { cssVar: '--menu-scale', unit?: 'px', file?: 'styles.css' }   previewed live in every canvas frame; the person presses Keep to write it into the CSS
      { style: { selector: '.cats', prop: 'gap' }, unit: 'px' }        the same for one declaration (use cssVar when the CSS already has a variable)
      { css: { on: { '--font': '"Courier New", monospace', 'body': { background: '#000' } }, off: { … } } }  a toggle (or a select: one entry per option value) that switches several CSS values at once, e.g. a theme; keys starting with -- are custom properties, other keys are selectors
      { store: 'key' }   sets site.store live        { fixture: { on: 'empty-menu', frames?: ['menu.html'] } }  a toggle (or a select of fixtures) switches frames to a fixture
    { type: 'button', label, run: "code" } runs as the person, in the workspace being viewed, with \`values\` in scope
  widgets: { type: 'value' | 'chart' | 'table' | 'list' | 'text', label?, from } (charts: kind: 'line' | 'bar'; a text widget may have markdown instead of from)
    from: { data: 'orders', where?, count?, sum?: field, group?: field, of?: field } | { store: key, count? } | { issues: true } (check issues over time) | { scenarios: true, count? }
          | { events: kind | true, per?: 'minute' | 'hour' } | { frameEvents: 'click' | 'change' | 'nav' | 'load' | 'console' | 'error' | true, frame?, count?, per? } | { frame: frameIdOrRoute, count | text: selector } | { eval: "read-only code; \`values\` in scope" } | { lib: name, args? }
    widgets refresh by themselves when what they read changes (an eval source also when a control moves)
  ui.values(id) -> current values (and what the person changed)   ui.set(id, controlId, value)   ui.panels()   ui.closePanel(id)
  await ui.ask(id, spec?, {label}?) shows the panel and waits for Done: returns the values (Cancel throws kind approval). Use it to let the person pick (a color, a variant) before you build.
  Offer a panel when the person is tuning something visual (sizes, spacing, colors: sliders bound to CSS variables, then they Keep the values), or asks to watch numbers. Keep it small: 2–6 items.
ui.pins() -> open comment pins [{id, n, route, src, text}]     ui.resolvePin(id, note)     ui.pin(frameId, target, text) files a pin
session.mark(label, {kind, why}?)  kind: milestone (default), decision (you chose between options; say why), question (you guessed instead of asking), checkpoint (before a risky step)
session.marks()   session.events({kind?, path?, since?, limit?})
session.diff(markLabelOrIndex) -> unified diff of main since then     session.workspace() -> where your writes go
session.recall(query, {limit, all}?) -> earlier messages of this thread (or of all threads) that mention the words: [{n, role, when, text}]     session.message(n) -> one message in full, with its evals
  Long threads: older messages are folded into a summary at the top of your context; recall and message reach what it left out.
session.stream({kind, frame, since, limit}?) -> recent events, oldest first: project events (write, data, mark, scenario, eval, accept, …) and canvas frame events (click, change, nav, load, console, error: what the person does in Play mode and what pages log)
  await session.waitFor(kind | [kinds], {frame, match, timeout}?) waits for the next one (default 30 s), e.g. await session.waitFor('click', { frame: 'menu.html', match: 'Add' }) after asking the person to try something
sleep(ms)

How pages run: every .html file is a route. <link rel=stylesheet href=x.css> and <script src=x.js> load project files. Page scripts get window.site:
  site.db.rows(table, where?) / insert(table, row) / update(table, id, patch) / remove(table, id) -> Promises; site.db.on(table, fn) on changes
  site.store.get(key, default) / set(key, value) / on(key, fn): small shared state across all frames (survives reloads)
  Relative links between .html files navigate inside the frame. There is no network: no CDN scripts, no remote images, no fetch.
Markdown files (README.md, notes, specs) render in the Docs panel. Read README.md first if there is one, and keep it current when you change pages or tables.

Working rules:
- Look before you change: list files, read the relevant ones (use files.lines for long files), check frames.
- Prefer files.replace for small edits; write whole files when creating or rewriting.
- Several small evals beat one huge one. Batch reads in one eval with par or Promise.all.
- After changing a page, check the effects in the eval result; call frames.check or frames.text when you need more.
- Your file writes go to the workspace session.workspace() names. If it is a proposal, the person reviews and accepts it; say what you changed so they can judge.
- In main, data tables are live: change rows only when asked. In a proposal, a table is copied into the proposal on its first write and main's rows change only when the person accepts it.
- When you add or change a flow (ordering, sign-up, a form), add or update a scenario for it and run it. Use a fixture for edge cases (empty table, long names, many rows).
- Mark milestones with session.mark("short label"); mark decisions and guesses with their kind, so the person can audit them later.
- When you will need something again (a file list, rows, frame ids), keep it in a top-level variable. When a helper will be useful in later sessions, save it with lib.def.
- Finish with a short summary in Markdown (short paragraphs, bullets, \`code\`; no big headings): what you changed, where, and anything left to do. Cite places as \`file:line\` (for example \`styles.css:73\`): they become links that open the file.`

// ---------- roles for subagents ----------
const ROLES = {
  explorer: { describe: 'Read-only investigator. Reads code, data and frames; answers with evidence and `file:line` links. Cannot write.', mode: 'read', evals: 12 },
  reviewer: { describe: 'Reviews a proposal: reads its diff, renders and checks its frames, and returns a verdict. Cannot write.', mode: 'read', evals: 12, output: '{verdict: "approve"|"changes", comments: string}' },
  qa: { describe: 'QA. Runs the scenarios (scenarios.runAll), writes new scenarios for important flows that have none (scenarios.save; fixtures.save for edge-case data), sweeps every frame for overflow, contrast, accessibility and console errors, and files a pin on each problem with ui.pin(frameId, target, text). May write only scenarios/ and fixtures/, not code or data.', mode: 'tests', evals: 16, output: '{pins: number, scenarios: {passed: number, failed: number, added: number}, summary: string}' },
  builder: { describe: 'Builds what it is asked in a proposal of its own (a workspace the person reviews), checks the frames, and summarizes what it changed.', mode: 'auto', own: true, evals: 20 }
}
const MAX_DEPTH = 2

// ---------- the agent: one sample() call per turn, the eval tool in a loop ----------
const Agent = {
  sample: null, ready: false, ev: emitter(), turns: new Map(),
  async init() {
    try { if (window.claude && window.claude.use) this.sample = await window.claude.use('sample') } catch { this.sample = null }
    this.ready = true; this.ev.emit('ready')
  },
  busy(tid) { return this.turns.has(tid) },
  anyBusy() { return this.turns.size > 0 },
  context(P, ws, th) {
    const files = P.list(ws).map(p => p + ' (' + P.read(p, ws).split('\n').length + ' lines)').join(', ')
    const tables = [...P.tablesIn(ws).values()].map(t => t.name + '[' + t.cols.join(',') + '] ' + t.rows.length + ' rows' + (ws !== 'main' && P.ownsTable(t.name, ws) ? ' (proposal copy)' : '')).join('; ') || 'none'
    const frames = P.board().frames.map(f => { const v = App.hostFor(f.id); return f.id + (f.label ? ' "' + f.label + '"' : '') + ' ' + (v ? v.route : f.route) + ' ' + f.w + 'x' + f.h + ' at ' + f.x + ',' + f.y + (v && v.errors ? ' ' + v.errors + ' errors' : '') + (v && v.issues.length ? ' ' + v.issues.length + ' issues' : '') }).join('; ')
    const sel = App.sel ? App.sel.tag + (App.sel.id ? '#' + App.sel.id : '') + (App.sel.cls ? '.' + App.sel.cls.split(' ').join('.') : '') + ' at ' + App.sel.src + ' in ' + App.sel.route + (App.sel.text ? ' "' + App.sel.text.slice(0, 60) + '"' : '') : 'nothing'
    const pins = (P.meta.pins || []).filter(p => !p.resolved).map(p => '#' + p.n + ' on ' + p.route + ' @' + (p.src || '?') + ': ' + p.text).join('\n') || 'none'
    const issues = []; for (const fh of FrameHosts) if (!fh.headless && fh.project === P) for (const i of fh.issues) issues.push(fh.route + ' ' + fh.w + 'px: ' + i.message + (i.src ? ' @' + i.src : ''))
    const props = P.openOverlays().map(o => o.id + ' "' + o.title + '" by ' + (o.by === 'agent' ? 'Claude' : 'you') + ', ' + plural(P.changes(o.id).length, 'change')).join('; ') || 'none'
    return 'Project "' + P.title + '". Workspace for your writes: ' + (ws === 'main' ? 'main (direct)' : 'proposal "' + (P.overlays.get(ws) || {}).title + '"') +
      '\nFiles: ' + files + '\nTables: ' + tables + '\nFrames: ' + frames + '\nOpen proposals: ' + props + '\nSelected: ' + sel + '\nOpen pins:\n' + pins + '\nCurrent check issues: ' + (issues.slice(0, 8).join('; ') || 'none') +
      '\nSaved lib functions: ' + (libEntries(P, ws).map(l => 'lib.' + l.name + '(' + l.params.join(', ') + ')' + (l.description ? ' — ' + l.description : '')).join('; ') || 'none') +
      '\nYour variables from earlier evals: ' + (th && th.scope ? (scopeSummary(th.scope) || 'none') + (th.scope.skipped && th.scope.skipped.length ? ' (not kept: ' + th.scope.skipped.join(', ') + ')' : '') : 'none')
  },
  // ---- what Claude sees of a thread: a running summary of older messages, then the recent ones verbatim ----
  HIST_CHARS: 28000, KEEP_CHARS: 12000, KEEP_MIN: 4, MAX_MSGS: 30,
  // one message as history; detail adds a line per eval (what it ran, how it went, what it changed)
  renderMsg(m, detail) {
    if (m.role === 'user') return (m.from ? '(from the ' + m.from + ') ' : '') + (m.text || '')
    const steps = m.steps || [], wrote = [...new Set(steps.flatMap(s => (s.calls || []).filter(c => /write|replace|remove|insert|update|save/.test(c))))]
    let t = m.text || (m.error ? '(failed: ' + m.error + ')' : '(no reply)')
    if (!steps.length) return t
    if (!detail) return t + '\n[' + plural(steps.length, 'eval') + (wrote.length ? ', used ' + wrote.join(', ') : '') + ']'
    return t + '\n[evals: ' + steps.map((s, k) => '\n  ' + (k + 1) + '. ' + (s.status === 'ok' ? '' : (s.status || '?') + ' ') + ((s.code || '').split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90) +
      (s.status === 'error' && s.out ? ' → ' + s.out.slice(0, 120) : '') + (effectsLine(s.effects) ? ' → ' + effectsLine(s.effects).slice(0, 140) : '')).join('') + ']'
  },
  // fold older messages into th.summary when the history gets long. end: messages before the current exchange
  async compact(P, th, { end = th.msgs.length, force = false, signal, onStart } = {}) {
    const start = th.summary ? th.summary.upTo : 0
    if (end - start < 2) return null
    const sizes = th.msgs.slice(start, end).map(m => this.renderMsg(m, false).length), total = sizes.reduce((a, b) => a + b, 0)
    if (!force && total <= this.HIST_CHARS && sizes.length <= this.MAX_MSGS) return null
    // keep the newest messages verbatim (at least KEEP_MIN, up to KEEP_CHARS); the cut lands on a message from the person
    let keep = 0, acc = 0
    for (let k = sizes.length - 1; k >= 0; k--) { if (keep >= (force ? 2 : this.KEEP_MIN) && (force || acc + sizes[k] > this.KEEP_CHARS)) break; acc += sizes[k]; keep++ }
    let cut = end - keep
    while (cut > start && th.msgs[cut] && th.msgs[cut].role !== 'user') cut--
    if (cut <= start) { cut = end - keep; while (cut < end && th.msgs[cut].role !== 'user') cut++ }
    if (cut <= start || cut >= end) return null
    if (onStart) onStart(cut - start)
    const part = th.msgs.slice(start, cut), lastT = part[part.length - 1].t
    const marks = P.events.filter(e => e.kind === 'mark' && e.thread === th.id && e.t <= lastT && (!th.summary || e.t > th.summary.t0)).map(e => '- ' + (e.mk || 'mark') + ': ' + e.label + (e.note ? ' (' + e.note + ')' : ''))
    const transcript = part.map((m, k) => '[' + (start + k + 1) + '] ' + (m.role === 'user' ? 'Person: ' : 'Claude: ') + trunc(this.renderMsg(m, true), 3000)).join('\n\n')
    const prompt = 'You keep the running summary of a conversation between a person and Claude, a coding agent inside Sitebench (an IDE for small websites). Older messages are about to leave Claude\'s context; your summary replaces them, so Claude must be able to continue the work from it alone. Merge the previous summary with the new messages.\n\n' +
      'Write Markdown, at most 350 words, under these bold headings, skipping any with nothing under it:\n**Goals** what the person wants, constraints and preferences (their words where it matters)\n**Decisions** what was decided and why\n**Done** what was built or changed: files, tables, scenarios, fixtures, proposals (accepted, open or rejected)\n**Didn\'t work** what was tried and dropped, and why\n**Open** unanswered questions, things promised for later, known problems\n**Names** frame ids, variables, lib functions, fixtures and scenarios worth remembering\n\n' +
      'Be specific (file:line, names, numbers). Do not add anything that is not in the messages. Reply with the summary only.\n\n' +
      'Previous summary:\n' + (th.summary ? th.summary.text : '(none: this is the start of the thread)') + '\n\nMessages ' + (start + 1) + '–' + cut + ':\n' + trunc(transcript, 40000) + (marks.length ? '\n\nMarks on the timeline from this stretch:\n' + marks.join('\n') : '')
    let text = '', by = 'claude'
    try { if (this.sample) { const r = await this.sample(prompt, { modelTier: 'quick', cache: false, signal }); text = (r && r.text || '').trim() } } catch (e) { if (signal && signal.aborted) throw e }
    if (text.length < 40) { by = 'fallback'; text = this.plainSummary(th, start, cut) }
    th.summary = { upTo: cut, text: trunc(text, 6000), by, t: now(), t0: lastT, chars: total }
    P.saveThread(th)
    P.log({ kind: 'compact', who: 'ide', ws: 'main', thread: th.id, note: 'summarized messages 1–' + cut + ' of "' + th.title + '" for Claude' + (by === 'fallback' ? ' (without a model)' : '') })
    P.ev.emit('threads')
    return th.summary
  },
  // a summary without a model: the requests, the first line of each reply, the files written
  plainSummary(th, start, cut) {
    const out = th.summary ? [th.summary.text, ''] : [], req = [], rep = [], files = new Set()
    th.msgs.slice(start, cut).forEach((m, k) => {
      const n = start + k + 1
      if (m.role === 'user') req.push('- [' + n + '] ' + trunc((m.text || '').replace(/\s+/g, ' '), 200))
      else { const l = (m.text || m.error || '').split('\n').find(x => x.trim()); if (l) rep.push('- [' + n + '] ' + trunc(l.replace(/^#+\s*/, ''), 160)); for (const s of m.steps || []) for (const f of (s.effects && s.effects.files) || []) files.add(f.path) }
    })
    if (req.length) out.push('**Requests**', ...req)
    if (rep.length) out.push('**Replies**', ...rep)
    if (files.size) out.push('**Files written** ' + [...files].join(', '))
    return out.join('\n')
  },
  // the conversation so far (the model is memoryless), then the current state on the last user message
  messages(P, th, ws, text, head) {
    const start = th.summary ? th.summary.upTo : 0, end = Math.max(start, th.msgs.length - 2)
    const hist = th.msgs.slice(start, end), agentIdx = hist.map((m, k) => m.role === 'agent' ? k : -1).filter(k => k >= 0).slice(-2)
    let rendered = hist.map((m, k) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: this.renderMsg(m, agentIdx.includes(k)), skip: m.role !== 'user' && !m.text && !(m.steps && m.steps.length) }))
      .filter(m => !m.skip)
    // still too long (no summary yet, or one huge message): drop the oldest and say so
    let dropped = 0
    while (rendered.length > 2 && rendered.reduce((a, m) => a + m.content.length, 0) > this.HIST_CHARS) { rendered.shift(); dropped++ }
    while (rendered.length && rendered[0].role !== 'user') { rendered.shift(); dropped++ }
    const merged = []; for (const m of rendered) { const last = merged[merged.length - 1]; if (last && last.role === m.role) last.content += '\n\n' + m.content; else merged.push({ role: m.role, content: m.content }) }
    let earlier = ''
    if (th.summary) earlier = 'Earlier in this thread (messages 1–' + th.summary.upTo + ', summarized; session.recall(query) searches them and session.message(n) reads one in full):\n' + th.summary.text + '\n\n' + (merged.length ? 'The conversation continues:\n\n' : '')
    if (dropped) earlier += '(' + plural(dropped, 'older message') + ' not shown; session.recall(query) searches them.)\n\n'
    const cur = 'Current state:\n' + this.context(P, ws, th) + '\n\n' + (th.parent ? 'The main agent asks:\n' : 'The person says:\n') + text
    if (merged.length) { merged[0].content = head + earlier + merged[0].content; if (merged[merged.length - 1].role === 'user') merged.push({ role: 'assistant', content: '(continuing)' }); merged.push({ role: 'user', content: cur }) }
    else merged.push({ role: 'user', content: head + earlier + cur })
    return merged
  },
  // one model turn on a thread: the eval tool runs in the thread's sandbox session. Throws on failure.
  async turn(P, th, msg, text, o) {
    const ctx = { project: P, ws: o.ws, who: 'agent', thread: th.id, mode: th.mode, depth: o.depth || 0, budget: o.budget, role: th.role || null, tier: th.tier, model: th.model, signal: o.signal, children: [] }
    const api = hostAPI(ctx)
    ctx.onApproval = card => { msg.approval = card; this.ev.emit('step', th.id) }
    ctx.onPanel = id => { msg.panels = msg.panels || []; if (!msg.panels.includes(id)) msg.panels.push(id); this.ev.emit('step', th.id) }
    const tool = {
      name: 'eval',
      description: 'Run a JavaScript async function body in the Sitebench sandbox with the host API in scope (files, data, frames, ui, session, lib) and the term core (step, seq, par, delegate, …). Use `return` for the result. Returns {ok, value, logs, error, effects}.',
      inputSchema: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript statements; may use await; return the value you want back' } }, required: ['code'] },
      execute: async input => {
        const code = String(input && input.code || '')
        const step = { code, t: now(), status: 'running' }
        msg.steps.push(step); this.ev.emit('step', th.id)
        const b = o.budget
        if (b.used >= b.max) { step.status = 'error'; step.out = 'eval budget used up'; this.ev.emit('step', th.id); throw new Error('eval budget (' + b.max + ' for this ' + (th.parent ? 'delegation' : 'turn') + ') used up: stop and summarize') }
        for (let x = b; x; x = x.parent) x.used++
        if (th.mode === 'ask') {
          step.status = 'ask'; this.ev.emit('step', th.id)
          const ok = await new Promise(res => { step.decide = res; if (o.signal) o.signal.addEventListener('abort', () => res(false)) })
          delete step.decide
          if (!ok) { step.status = 'skipped'; this.ev.emit('step', th.id); return JSON.stringify({ ok: false, error: { kind: 'declined', message: 'the person declined to run this eval; ask or try something else' } }) }
          step.status = 'running'; this.ev.emit('step', th.id)
        }
        const r = await runEval(ctx, code, api, { sid: th.id, restore: th.scope && th.scope.vars })
        step.ok = r.ok; step.ms = r.ms; step.engine = r.engine; step.calls = r.calls; step.effects = r.effects || undefined
        if (ctx.children.length) step.children = ctx.children.splice(0)
        if (r.scope) th.scope = r.scope
        step.logs = (r.logs || []).map(l => (l.level !== 'log' ? l.level + ': ' : '') + l.text)
        step.out = r.ok ? trunc(toYAML(r.value), 6000) : (r.error.kind + ': ' + r.error.message + (r.error.line ? ' (line ' + r.error.line + ')' : '')); step.fmt = r.ok ? 'yaml' : undefined
        step.status = r.ok ? 'ok' : 'error'
        P.log({ kind: 'eval', who: 'agent', ws: ctx.ws, thread: th.id, ok: r.ok, note: (code.split('\n').find(l => l.trim() && !l.trim().startsWith('//')) || '').trim().slice(0, 90), calls: [...new Set(r.calls || [])].slice(0, 12) })
        this.ev.emit('step', th.id)
        const out = { ok: r.ok, value: r.ok ? r.value : undefined, logs: step.logs.length ? step.logs : undefined, error: r.ok ? undefined : r.error, effects: r.effects || undefined }
        return trunc(JSON.stringify(out), 8000)
      }
    }
    const R = th.role && ROLES[th.role]
    const head = (R ? 'You are the ' + th.role + ' subagent, called by the main agent through delegate(). ' + R.describe + (R.mode === 'read' ? ' Writes are refused (policy errors); canvas arrangement and ui.pin are allowed.' : R.mode === 'tests' ? ' You may write only scenarios/ and fixtures/ (other writes are refused); canvas arrangement and ui.pin are allowed.' : '') + ' Reply to the main agent, briefly. Your budget is ' + o.budget.max + ' evals.\n\n' : '') + API_GUIDE + '\n\n'
    // long thread: fold older messages into the summary first
    try { await this.compact(P, th, { end: th.msgs.length - 2, signal: o.signal, onStart: n => { msg.note = 'Summarizing ' + plural(n, 'earlier message') + '…'; this.ev.emit('text', th.id) } }) } catch (e) { if (o.signal && o.signal.aborted) throw e }
    if (msg.note) { delete msg.note; this.ev.emit('text', th.id) }
    const res = await this.sample(this.messages(P, th, o.ws, text, head), { tools: [tool], onText: ({ text: t }) => { msg.text = t; this.ev.emit('text', th.id) }, signal: o.signal, modelTier: th.tier || 'default', cache: false, ...(th.model ? { model: th.model } : {}) })
    if (res && res.modelApplied) msg.model = res.modelApplied
    msg.text = res && res.text || msg.text; if (res && res.truncated) msg.text += '\n[reply truncated]'
    return msg.text
  },
  async send(P, th, text) {
    if (!this.sample) throw new Error('Claude is not available in this view')
    if (this.busy(th.id)) return
    const userMsg = { role: 'user', text, t: now(), ctx: { sel: App.sel ? { src: App.sel.src, tag: App.sel.tag, route: App.sel.route } : null, pins: (P.meta.pins || []).filter(p => !p.resolved).length } }
    th.msgs.push(userMsg)
    if (th.msgs.filter(m => m.role === 'user').length === 1 && /^Thread \d+$/.test(th.title)) th.title = text.slice(0, 32) + (text.length > 32 ? '…' : '')
    // pick the workspace
    let ws = 'main'
    if (th.mode !== 'read' && th.mode !== 'tests' && th.target === 'overlay') {
      let ov = th.ovId && P.overlays.get(th.ovId)
      if (!ov || ov.status !== 'open') { ov = P.newOverlay({ title: text.slice(0, 40) + (text.length > 40 ? '…' : ''), by: 'agent', thread: th.id }); th.ovId = ov.id }
      ws = ov.id
      if (App.ws !== ws) App.setWs(ws)
    } else if (th.mode === 'read' || th.mode === 'tests') ws = App.ws
    const msg = { role: 'agent', text: '', steps: [], t: now(), ws, status: 'running', tier: th.tier }
    th.msgs.push(msg)
    const abort = new AbortController(), turn = { abort, msg, thread: th }
    this.turns.set(th.id, turn); this.ev.emit('turn', th.id)
    P.log({ kind: 'msg', who: 'you', ws, thread: th.id, note: text.slice(0, 140) })
    try {
      await this.turn(P, th, msg, text, { ws, depth: 0, budget: { max: 30, used: 0, parent: null }, signal: abort.signal })
      msg.status = 'done'
    } catch (e) {
      const code = e && e.code
      msg.status = abort.signal.aborted ? 'stopped' : 'error'
      msg.error = abort.signal.aborted ? 'Stopped.' : code === 'not_granted' ? 'Claude is not available for this page (not granted).' : code === 'rate_limited' ? 'Rate limited: wait a little and send again.' : (e && e.message || String(e))
      if (e && e.text && !msg.text) msg.text = e.text
      if (code === 'not_granted') { this.sample = null; this.ev.emit('ready') }
    } finally {
      this.turns.delete(th.id); msg.approval = null
      for (const s of msg.steps) if (s.status === 'running' || s.status === 'ask') s.status = 'skipped'
      const ov = ws !== 'main' && P.overlays.get(ws)
      const changed = ov ? P.changes(ws).length : 0
      if (ov && ov.status === 'open' && !changed && !Object.keys(ov.files).length && !P.tableChanges(ov.id).length) { ov.status = 'discarded'; P.saveOverlay(ov); th.ovId = null; P.ev.emit('overlays'); if (App.ws === ws) App.setWs('main') }
      msg.summary = changed ? plural(changed, 'file') + ' changed in "' + ov.title + '"' : ''
      P.log({ kind: 'turn', who: 'agent', ws, thread: th.id, ok: msg.status === 'done', note: (msg.text || msg.error || '').split('\n')[0].slice(0, 140), evals: msg.steps.length })
      P.saveThread(th); P.ev.emit('threads')
      this.ev.emit('turn', th.id)
      if (changed) toast('Proposal ready: ' + plural(changed, 'file') + ' to review')
    }
  },
  // delegate(role, task): a subagent with its own thread, sandbox session and timeline lane. Its evals come
  // out of the caller's budget; it may delegate in turn, to a depth of 2.
  async delegate(pctx, role, task, opts = {}) {
    const R = ROLES[role]
    if (!R) throw Object.assign(new Error('no role "' + role + '". Roles: ' + Object.keys(ROLES).join(', ')), { kind: 'invalid' })
    if (!this.sample) throw Object.assign(new Error('Claude is not available in this view'), { kind: 'unavailable' })
    if ((pctx.depth || 0) >= MAX_DEPTH) throw Object.assign(new Error('delegation depth is capped at ' + MAX_DEPTH), { kind: 'budget' })
    const pb = pctx.budget || { max: 30, used: 0, parent: null }
    const room = Math.min(...(function* () { for (let x = pb; x; x = x.parent) yield x.max - x.used })())
    const want = Math.min(opts.evals || R.evals, room - 1)
    if (want < 1) throw Object.assign(new Error('not enough eval budget left to delegate (' + room + ' left)'), { kind: 'budget' })
    const budget = { max: want, used: 0, parent: pb }
    const P = pctx.project
    const th = P.newThread(role + ': ' + task.replace(/\s+/g, ' ').slice(0, 40))
    Object.assign(th, { parent: pctx.thread || 'eval', role, mode: R.mode, target: R.own ? 'overlay' : 'main', tier: opts.tier || pctx.tier || 'default', model: opts.model !== undefined ? opts.model : (pctx.model || null) })
    let ws = pctx.ws, ov = null
    if (R.own) { ov = P.newOverlay({ title: role + ': ' + task.replace(/\s+/g, ' ').slice(0, 36), by: 'agent', thread: th.id }); th.ovId = ov.id; ws = ov.id }
    let prompt = task
    if (role === 'reviewer') {
      const target = opts.proposal || (pctx.ws !== 'main' ? pctx.ws : (P.openOverlays().slice(-1)[0] || {}).id)
      if (!target || !P.overlays.get(target)) throw Object.assign(new Error('reviewer needs a proposal: pass { proposal: id } (open: ' + (P.openOverlays().map(o => o.id).join(', ') || 'none') + ')'), { kind: 'invalid' })
      ws = target
      const tch = P.tableChanges(target).map(c => 'table ' + c.name + ': ' + (c.created ? 'new, ' : c.dropped ? 'dropped' : '') + (c.dropped ? '' : '+' + c.added.length + ' −' + c.removed.length + ' ~' + c.changed.length + ' rows')).join('\n')
      prompt += '\n\nYou are reviewing proposal "' + P.overlays.get(target).title + '" (id ' + target + '; your reads and frame checks see it). frames.compare(frameId) lists its layout changes against main; scenarios.runAll() runs the scenarios against it. Its changes against main:\n' + trunc(P.changes(target).map(c => diffText(c.path, c.before, c.after)).join('\n\n'), 7000) + (tch ? '\n\nData changes (proposal copies of tables):\n' + tch : '')
    }
    const out = opts.output || R.output
    if (out) prompt += '\n\nEnd your reply with JSON only (no code fences), matching: ' + out
    th.msgs.push({ role: 'user', text: task, t: now(), from: pctx.role || 'main agent' })
    const msg = { role: 'agent', text: '', steps: [], t: now(), ws, status: 'running', tier: th.tier }
    th.msgs.push(msg)
    const abort = new AbortController()
    if (pctx.signal) { if (pctx.signal.aborted) abort.abort(); else pctx.signal.addEventListener('abort', () => abort.abort()) }
    this.turns.set(th.id, { abort, msg, thread: th }); this.ev.emit('turn', th.id); P.ev.emit('threads')
    if (pctx.children) pctx.children.push({ thread: th.id, role })
    P.log({ kind: 'delegate', who: pctx.who || 'agent', ws: pctx.ws, thread: pctx.thread, note: role + ': ' + task.slice(0, 120), child: th.id })
    let failure = null
    try { await this.turn(P, th, msg, prompt, { ws, depth: (pctx.depth || 0) + 1, budget, signal: abort.signal }); msg.status = 'done' }
    catch (e) { failure = e; msg.status = abort.signal.aborted ? 'stopped' : 'error'; msg.error = e && e.message || String(e) }
    finally {
      this.turns.delete(th.id)
      for (const s of msg.steps) if (s.status === 'running' || s.status === 'ask') s.status = 'skipped'
      P.log({ kind: 'turn', who: 'agent', ws, thread: th.id, ok: msg.status === 'done', note: (msg.text || msg.error || '').split('\n')[0].slice(0, 140), evals: msg.steps.length })
      P.saveThread(th); P.ev.emit('threads'); this.ev.emit('turn', th.id)
    }
    const changes = ov ? [...P.changes(ov.id).map(c => c.path), ...P.tableChanges(ov.id).map(c => 'table ' + c.name)] : undefined
    if (ov && !changes.length && ov.status === 'open') { ov.status = 'discarded'; P.saveOverlay(ov); P.ev.emit('overlays') }
    if (failure) throw Object.assign(new Error(role + ' failed: ' + (msg.error || 'unknown') + ' (thread ' + th.id + ')'), { kind: abort.signal.aborted ? 'cancelled' : 'agent' })
    const parsed = out ? parseJSONReply(msg.text || '') : undefined
    return { role, thread: th.id, evals: budget.used, result: parsed !== undefined ? parsed : (msg.text || ''), text: trunc(msg.text || '', 4000),
      proposal: ov && changes.length ? ov.id : undefined, changes: ov ? changes : undefined }
  },
  stop(tid) { const t = this.turns.get(tid); if (t) t.abort.abort() }
}
