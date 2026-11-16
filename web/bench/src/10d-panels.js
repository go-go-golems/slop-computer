// ---------- panels: small UIs Claude declares ----------
// A panel is a list of items. Controls (slider, toggle, select, text, color, button) hold values; a control can be
// bound to the pages (a CSS variable or a style previewed live in every frame, a site.store key, a fixture), and the
// person can keep a previewed value in the CSS file. Widgets (value, chart, table, list, text) show live values
// from the project: table rows, the store, check issues, scenario results, events, a frame's DOM, or read-only code.
import { clamp, clone, debounce, fmtAgo, fmtTime, now, plural, trunc } from './lib/util.js';
import { clear, h, modal, popMenu, svgEl, toast } from './lib/dom.js';
import { hlYAML, renderMarkdown, toYAML } from './lib/text.js';
import { since } from './model/timeline.js';

const PANEL_CONTROLS = ['slider', 'toggle', 'select', 'text', 'color', 'button']
const PANEL_WIDGETS = ['value', 'chart', 'table', 'list', 'text']
const SOURCE_KEYS = ['data', 'store', 'issues', 'scenarios', 'events', 'frameEvents', 'frame', 'eval', 'lib']
const FRAME_EVENT_KINDS = ['click', 'change', 'nav', 'load', 'console', 'error']

function checkPanel(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a panel is { title, items: [ … ] }'
  if (!Array.isArray(spec.items) || !spec.items.length) return 'items must be a non-empty list of controls and widgets'
  if (spec.items.length > 24) return 'at most 24 items in a panel'
  const ids = new Set()
  for (const [i, it] of spec.items.entries()) {
    const where = 'item ' + (i + 1) + (it && it.id ? ' (' + it.id + ')' : '')
    if (!it || typeof it !== 'object') return where + ' is not an object'
    if (![...PANEL_CONTROLS, ...PANEL_WIDGETS].includes(it.type)) return where + ': type is one of ' + [...PANEL_CONTROLS, ...PANEL_WIDGETS].join(', ')
    if (PANEL_CONTROLS.includes(it.type) && it.type !== 'button') {
      if (!it.id || !/^[A-Za-z_][\w-]{0,30}$/.test(it.id)) return where + ': a ' + it.type + ' needs an id (a word), to read its value by'
      if (ids.has(it.id)) return where + ': id "' + it.id + '" is used twice'; ids.add(it.id)
    }
    if (it.type === 'slider' && (typeof it.min !== 'number' || typeof it.max !== 'number' || it.max <= it.min)) return where + ': a slider needs numbers min < max'
    if (it.type === 'select' && !Array.isArray(it.options) && !(it.bind && (it.bind.fixture || it.bind.css))) return where + ': a select needs options: [value, …] or [{ value, label }, …]'
    if (it.type === 'button' && typeof it.run !== 'string') return where + ': a button needs run: "code" (it runs as the person, with `values` in scope)'
    if (it.bind) {
      const b = it.bind, k = Object.keys(b).filter(x => ['cssVar', 'style', 'store', 'fixture', 'css'].includes(x))
      if (k.length !== 1) return where + ': bind is one of { cssVar: "--name", unit?, file? } | { style: { selector, prop }, unit?, file? } | { css: { on: {…}, off: {…} } } (toggle) or { css: { optionValue: {…} } } (select) | { store: key } | { fixture: { on?, off?, frames? } }'
      if (b.css) {
        if (!['toggle', 'select'].includes(it.type)) return where + ': bind.css is for a toggle ({ on, off }) or a select (one entry per option)'
        if (typeof b.css !== 'object' || !Object.keys(b.css).length) return where + ': bind.css maps each state to CSS: { on: { "--font": "…", "body": { "font-family": "…" } }, off: { … } }'
        for (const [state, map] of Object.entries(b.css)) {
          if (!map || typeof map !== 'object') return where + ': bind.css.' + state + ' must be an object'
          for (const [key, v] of Object.entries(map)) {
            if (key.startsWith('--')) { if (typeof v !== 'string' && typeof v !== 'number') return where + ': ' + key + ' in bind.css.' + state + ' must be a value' }
            else if (!v || typeof v !== 'object') return where + ': in bind.css.' + state + ', "' + key + '" is a selector, so it needs { property: value }'
          }
        }
      }
      if (b.cssVar && !/^--[\w-]+$/.test(b.cssVar)) return where + ': cssVar is a custom property name like "--menu-scale"'
      if (b.style && (!b.style.selector || !b.style.prop)) return where + ': style needs selector and prop'
    }
    if (['value', 'chart', 'table', 'list'].includes(it.type)) {
      if (!it.from || typeof it.from !== 'object' || !SOURCE_KEYS.some(k => k in it.from)) return where + ': from is one of ' + SOURCE_KEYS.map(k => '{ ' + k + ' }').join(', ')
    }
    if (it.type === 'chart' && it.kind && !['line', 'bar'].includes(it.kind)) return where + ': kind is line or bar'
  }
  return null
}

// ---------- the live preview: CSS variables and styles shown in every canvas frame, not yet in any file ----------
const Preview = {
  vars: {}, rules: {},              // name -> { value, panel }, 'selector|prop' -> { selector, prop, value, panel }
  payload() { return { vars: Object.fromEntries(Object.entries(this.vars).map(([k, v]) => [k, v.value])), rules: Object.values(this.rules).map(r => ({ selector: r.selector, prop: r.prop, value: r.value })) } },
  push() { const pv = this.payload(); for (const fh of FrameHosts) if (!fh.headless && fh.project === App.P) fh.push({ push: 'preview', preview: pv }); App.ev.emit('preview') },
  count(panel) { return Object.values(this.vars).filter(v => !panel || v.panel === panel).length + Object.values(this.rules).filter(r => !panel || r.panel === panel).length },
  clear(panel) { for (const [k, v] of Object.entries(this.vars)) if (!panel || v.panel === panel) delete this.vars[k]; for (const [k, r] of Object.entries(this.rules)) if (!panel || r.panel === panel) delete this.rules[k]; this.push() }
}
const cssFiles = (P, ws) => P.list(ws).filter(p => p.endsWith('.css'))
const fmtVal = (v, unit) => typeof v === 'number' ? String(Math.round(v * 1000) / 1000) + (unit || '') : String(v)

const Panels = {
  waiting: new Map(), runs: new Map(),
  list(P) { return P.meta.panels || (P.meta.panels = []) },
  get(P, id) { return this.list(P).find(p => p.id === id) || null },
  // create or replace; values the person set survive when the control is still there
  upsert(P, id, spec, o = {}) {
    const bad = checkPanel(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
    let p = this.get(P, id)
    const values = {}
    for (const it of spec.items) if (it.id && it.type !== 'button') values[it.id] = p && p.values && it.id in p.values ? p.values[it.id] : this.initial(P, it, o.ws || 'main')
    if (!p) { p = { id, created: now() }; this.list(P).push(p); while (this.list(P).length > 30) this.list(P).shift() }
    Object.assign(p, { spec: clone(spec), values, by: o.by || 'agent', thread: o.thread || p.thread || null, t: now(), pinned: o.pinned ?? p.pinned ?? false })
    P.saveMeta(); App.ev.emit('panels', id)
    return p
  },
  // a slider bound to a CSS variable starts at the file's value when there is one
  initial(P, it, ws) {
    if (it.value !== undefined) return it.value
    const b = it.bind || {}
    if (b.cssVar || b.style) {
      for (const f of b.file ? [b.file] : cssFiles(P, ws)) {
        const text = P.read(f, ws) || ''
        const m = b.cssVar ? new RegExp(b.cssVar.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;}]+)').exec(text) : (() => { const r = findRule(text, b.style.selector); if (!r) return null; return new RegExp('(?:^|[;{\\s])' + b.style.prop.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;}]+)').exec(text.slice(r.bodyStart, r.bodyEnd)) })()
        if (m) { const raw = m[1].trim(); if (it.type === 'slider') { const n = parseFloat(raw); if (!isNaN(n)) return n } else if (it.type !== 'toggle') return raw }
      }
    }
    if (b.store !== undefined && P.meta.store && b.store in P.meta.store) return P.meta.store[b.store]
    if (b.fixture && it.type === 'toggle') return false
    return it.type === 'slider' ? it.min : it.type === 'toggle' ? false : it.type === 'select' ? (this.options(P, it)[0] || {}).value ?? '' : it.type === 'color' ? '#000000' : ''
  },
  options(P, it) {
    if (it.bind && it.bind.css && !it.options) return Object.keys(it.bind.css).map(k => ({ value: k, label: k }))
    if (it.bind && it.bind.fixture && !it.options) return [{ value: '', label: 'Live data' }, ...fixtureList(P, App.ws).map(f => ({ value: f.name, label: f.name }))]
    return (it.options || []).map(o => typeof o === 'object' ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) })
  },
  // the person (or ui.set) changes a value: apply its binding
  set(P, p, id, v, { by = 'you' } = {}) {
    const it = p.spec.items.find(x => x.id === id); if (!it) throw Object.assign(new Error('no control "' + id + '" in panel ' + p.id), { kind: 'missing' })
    if (it.type === 'slider') v = clamp(+v, it.min, it.max)
    p.values[id] = v; this.saveSoon(P)
    const b = it.bind
    if (b && b.css) {
      // a theme switch: drop what this control previewed before, then preview the CSS of the chosen state
      for (const [k, x] of Object.entries(Preview.vars)) if (x.panel === p.id && x.item === id) delete Preview.vars[k]
      for (const [k, x] of Object.entries(Preview.rules)) if (x.panel === p.id && x.item === id) delete Preview.rules[k]
      const map = b.css[it.type === 'toggle' ? (v ? 'on' : 'off') : String(v)] || {}
      for (const [key, val] of Object.entries(map)) {
        if (key.startsWith('--')) Preview.vars[key] = { value: String(val), panel: p.id, item: id }
        else for (const [prop, pv] of Object.entries(val)) Preview.rules[key + '|' + prop] = { selector: key, prop, value: String(pv), panel: p.id, item: id }
      }
      Preview.push()
    }
    else if (b && b.cssVar) { Preview.vars[b.cssVar] = { value: fmtVal(v, b.unit), panel: p.id, item: id }; Preview.push() }
    else if (b && b.style) { Preview.rules[b.style.selector + '|' + b.style.prop] = { selector: b.style.selector, prop: b.style.prop, value: fmtVal(v, b.unit), panel: p.id, item: id }; Preview.push() }
    else if (b && b.store !== undefined) { P.meta.store[b.store] = clone(v); P.saveMeta(); for (const fh of FrameHosts) if (fh.project === P && !fh.fx) fh.push({ push: 'store', key: b.store, value: v }); App.ev.emit('store', b.store) }
    else if (b && b.fixture) {
      const name = it.type === 'toggle' ? (v ? b.fixture.on : (b.fixture.off || null)) : (v || null)
      const targets = P.board().frames.filter(f => !b.fixture.frames || b.fixture.frames === 'all' || [].concat(b.fixture.frames).includes(f.id) || [].concat(b.fixture.frames).includes(f.route))
      for (const f of targets) { f.fixture = name || undefined; for (const fh of App.canvas ? App.canvas.hostsFor(f.id) : []) fh.setFixture(f.fixture) }
      P.saveMeta(); P.ev.emit('frames')
    }
    p.log = (p.log || []).concat([{ t: now(), id, v, by }]).slice(-40)
    App.ev.emit('panelvalue', p.id, id)
  },
  saveSoon: debounce(P => P.saveMeta(), 600),
  // write the previewed values of a panel into the CSS (the workspace being viewed)
  keep(P, p) {
    const ws = App.ws, written = new Map()
    const fileFor = b => b.file || (cssFiles(P, ws).includes('styles.css') ? 'styles.css' : cssFiles(P, ws)[0])
    const textOf = f => written.has(f) ? written.get(f) : (P.read(f, ws) ?? '')
    for (const [name, v] of Object.entries(Preview.vars)) {
      if (v.panel !== p.id) continue
      const it = p.spec.items.find(x => x.id === v.item), f = fileFor(it.bind); if (!f) continue
      let t = textOf(f), re = new RegExp('(' + name.replace(/[-]/g, '\\-') + '\\s*:\\s*)([^;}]+)')
      if (re.test(t)) t = t.replace(re, (m, a) => a + v.value)
      else if (findRule(t, ':root')) t = cssSet(t, ':root', name, v.value)
      else t = ':root { ' + name + ': ' + v.value + '; }\n' + t
      written.set(f, t)
    }
    for (const r of Object.values(Preview.rules)) {
      if (r.panel !== p.id) continue
      const it = p.spec.items.find(x => x.id === r.item), f = fileFor(it.bind); if (!f) continue
      let t = textOf(f); t = cssSet(t, r.selector, r.prop, r.value) ?? (t.replace(/\s*$/, '') + '\n\n' + r.selector + ' {\n  ' + r.prop + ': ' + r.value + ';\n}\n')
      written.set(f, t)
    }
    const what = [...Object.entries(Preview.vars).filter(([, v]) => v.panel === p.id).map(([k, v]) => k + ': ' + v.value), ...Object.values(Preview.rules).filter(r => r.panel === p.id).map(r => r.selector + ' { ' + r.prop + ': ' + r.value + ' }')]
    for (const [f, t] of written) P.write(f, t, { ws, who: 'you', note: 'kept from panel "' + (p.spec.title || p.id) + '": ' + what.join(', ') })
    Preview.clear(p.id)
    return { files: [...written.keys()], what }
  },
  // a button: its code runs as the person, in the workspace being viewed, with the panel's values in scope
  async run(P, p, it) {
    const code = 'const values = ' + JSON.stringify(p.values) + '\n' + it.run
    const ctx = { project: P, ws: App.ws, who: 'you', mode: 'auto' }
    this.runs.set(p.id, { label: it.label, busy: true }); App.ev.emit('panelvalue', p.id)
    const r = await runEval(ctx, code, hostAPI(ctx), { sid: 'panel:' + P.id + ':' + p.id })
    P.log({ kind: 'eval', who: 'you', ws: App.ws, ok: r.ok, note: 'panel "' + (p.spec.title || p.id) + '": ' + (it.label || 'button'), calls: [...new Set(r.calls || [])].slice(0, 12) })
    this.runs.set(p.id, { label: it.label, ok: r.ok, out: r.ok ? (r.value === undefined ? 'done' : trunc(toYAML(r.value), 600)) : r.error.kind + ': ' + r.error.message, fx: effectsLine(r.effects) })
    App.ev.emit('panelvalue', p.id)
    return r
  },
  remove(P, id) { const l = this.list(P), i = l.findIndex(p => p.id === id); if (i >= 0) l.splice(i, 1); Preview.clear(id); const w = this.waiting.get(id); if (w) w.resolve(null); P.saveMeta(); App.ev.emit('panels', id) }
}

// ---------- live sources for widgets ----------
const Streams = {
  issues: [], events: [], frames: [],
  // what the person does on the canvas, and what the pages say: clicks, changes, navigation, loads, console
  frame(fh, kind, detail, extra) {
    const e = { t: now(), kind, frame: fh.route, w: fh.w, fid: fh.fid, ws: fh.ws, detail: String(detail || '').slice(0, 200), ...(extra || {}) }
    this.frames.push(e); if (this.frames.length > 500) this.frames.shift()
    App.ev.emit('frameevent', e)
  },
  // project events and frame events in one list, oldest first
  merged(P, { kind, frame, since, limit = 50 } = {}) {
    const kinds = kind ? [].concat(kind) : null
    const proj = P.events.filter(e => (since == null || e.t > since) && (!kinds || kinds.includes(e.kind)) && !frame).map(e => ({ t: e.t, source: 'project', kind: e.kind, who: e.who === 'agent' ? 'claude' : e.who, ws: e.ws, path: e.path, table: e.table, detail: e.label || e.note || '', i: e.i }))
    const fr = this.frames.filter(e => (since == null || e.t > since) && (!kinds || kinds.includes(e.kind)) && (!frame || e.frame === frame || e.fid === frame)).map(e => ({ t: e.t, source: 'frame', kind: e.kind, frame: e.frame + ' ' + e.w + 'px', detail: e.detail }))
    return [...proj, ...fr].sort((a, b) => a.t - b.t).slice(-clamp(+limit || 50, 1, 500))
  },
  init() {
    App.ev.on('health', () => { const v = App.health(), last = this.issues[this.issues.length - 1]; if (!last || last.v !== v || now() - last.t > 60000) { this.issues.push({ t: now(), v }); if (this.issues.length > 240) this.issues.shift() } })
    App.ev.on('project', () => { this.issues = []; this.frames = [] })
  },
  // what changes make a source worth reading again
  triggers(from) {
    if (from.data) return ['tables']
    if (from.store !== undefined) return ['store']
    if (from.issues) return ['health']
    if (from.scenarios) return ['scenarios']
    if (from.events) return ['events']
    if (from.frameEvents) return ['frameevent']
    if (from.frame) return ['frameready', 'tables', 'store']
    return ['files', 'tables', 'scenarios', 'panelvalue']
  },
  async read(P, from, p) {
    if (from.data) {
      let rows = P.rows(from.data, from.where, App.ws)
      if (from.count) return rows.length
      if (from.sum) return rows.reduce((a, r) => a + (+r[from.sum] || 0), 0)
      if (from.group) { const m = new Map(); for (const r of rows) { const k = String(r[from.group] ?? '—'); m.set(k, (m.get(k) || 0) + (from.of ? (+r[from.of] || 0) : 1)) } return [...m].map(([label, value]) => ({ label, value })) }
      if (from.limit) rows = rows.slice(-from.limit)
      return rows
    }
    if (from.store !== undefined) { const v = (P.meta.store || {})[from.store]; return from.count ? (Array.isArray(v) ? v.reduce((a, x) => a + (+(x && x.qty) || 1), 0) : v ? Object.keys(v).length : 0) : v }
    if (from.issues) return this.issues.map(x => ({ t: x.t, value: x.v }))
    if (from.scenarios) { const l = scenarioList(P, App.ws); return from.count ? l.filter(s => s.last && s.last.ok).length + ' / ' + l.length : l.map(s => ({ scenario: s.name, result: s.error ? 'invalid' : !s.last ? 'not run' : s.last.ok ? 'passes' : 'fails at step ' + (s.last.failedAt + 1), when: s.last ? fmtAgo(s.last.t) : '' })) }
    if (from.events) {
      const per = from.per === 'hour' ? 3600000 : 60000, n = clamp(+from.buckets || 30, 5, 120), end = Math.ceil(now() / per) * per, out = Array.from({ length: n }, (_, k) => ({ t: end - (n - k) * per, value: 0 }))
      for (const e of P.events) { if (from.events !== true && e.kind !== from.events) continue; const k = Math.floor((e.t - (end - n * per)) / per); if (k >= 0 && k < n) out[k].value++ }
      return out
    }
    if (from.frameEvents) {
      const kinds = from.frameEvents === true ? null : [].concat(from.frameEvents)
      const evs = this.frames.filter(e => (!kinds || kinds.includes(e.kind)) && (!from.frame || e.frame === from.frame || e.fid === from.frame))
      if (from.count) return evs.length
      if (from.per) { const per = from.per === 'hour' ? 3600000 : 60000, n = clamp(+from.buckets || 30, 5, 120), end = Math.ceil(now() / per) * per, out = Array.from({ length: n }, (_, k) => ({ t: end - (n - k) * per, value: 0 })); for (const e of evs) { const k = Math.floor((e.t - (end - n * per)) / per); if (k >= 0 && k < n) out[k].value++ } return out }
      return evs.slice(-(from.limit || 20)).reverse().map(e => ({ when: fmtTime(e.t), frame: e.frame + ' ' + e.w, kind: e.kind, what: e.detail }))
    }
    if (from.frame) {
      const fr = P.frame(from.frame) || P.board().frames.find(f => f.route === from.frame); if (!fr) throw new Error('no frame ' + from.frame)
      const { fh } = await layoutIn(P, fr, App.ws)
      if (from.count) return fh.call('count', [from.count], 3000)
      if (from.text) return fh.call('text', [from.text], 3000)
      throw new Error('frame sources take count or text: a selector')
    }
    if (from.eval || from.lib) {
      const code = 'const values = ' + JSON.stringify(p.values) + '\n' + (from.eval || 'return await lib.' + from.lib + '(...' + JSON.stringify(from.args || []) + ')')
      const ctx = { project: P, ws: App.ws, who: 'you', mode: 'read' }
      const r = await runEval(ctx, code, hostAPI(ctx), { sid: 'panelsrc:' + P.id + ':' + p.id })
      if (!r.ok) throw new Error(r.error.kind + ': ' + r.error.message)
      return r.value
    }
    throw new Error('unknown source')
  }
}

// ---------- charts: one axis, thin marks, a tooltip on hover ----------
function chartEl(data, it) {
  const W = 320, H = 128, L = 30, R = it.kind === 'line' && Array.isArray(data) && data.series ? 54 : 10, T = 8, B = 20
  const wrap = h('div.pchart'), tip = h('div.ptip', { hidden: true })
  // normalize: numbers | {label, value} | {t, value} | rows with x/y fields | { series: [{ name, points }] }
  let series
  const asPoints = arr => arr.map((d, i) => typeof d === 'number' ? { x: i, label: String(i + 1), y: d } : d && 'value' in d ? { x: d.t ?? i, label: d.label ?? (d.t ? fmtTime(d.t) : String(i + 1)), y: +d.value || 0 } : { x: it.x ? d[it.x] : i, label: String(it.x ? d[it.x] : i + 1), y: +(it.y ? d[it.y] : Object.values(d).find(v => typeof v === 'number')) || 0 })
  if (data && Array.isArray(data.series)) series = data.series.slice(0, 3).map(s => ({ name: s.name, pts: asPoints(s.points || []) }))
  else if (Array.isArray(data)) series = [{ name: it.label || '', pts: asPoints(data) }]
  else { wrap.appendChild(h('p.note', 'Nothing to chart (expected a list).')); return wrap }
  const kind = it.kind || (series[0].pts.every(p => typeof p.x === 'number' && p.x > 1e11) ? 'line' : 'bar')
  const all = series.flatMap(s => s.pts); if (!all.length) { wrap.appendChild(h('p.note', 'No data yet.')); return wrap }
  const ymax = Math.max(0, ...all.map(p => p.y)), ymin = Math.min(0, ...all.map(p => p.y)), span = ymax - ymin || 1
  const nice = v => { const e = Math.pow(10, Math.floor(Math.log10(Math.abs(v) || 1))), f = Math.abs(v) / e; return Math.sign(v) * (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e }
  const top = ymax > 0 ? nice(ymax) : 0, bot = ymin < 0 ? nice(ymin) : 0, Y = v => T + (H - T - B) * (1 - (v - bot) / ((top - bot) || span))
  const svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', role: 'img', 'aria-label': (it.label || 'chart') + ': ' + series.map(s => s.pts.length + ' points').join(', ') })
  const ints = all.every(p => Number.isInteger(p.y)), mid = (bot + top) / 2
  for (const v of ints && !Number.isInteger(mid) ? [bot, top] : [bot, mid, top]) { svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: v === 0 ? 'base' : 'grid' })); const tx = svgEl('text', { x: L - 4, y: Y(v) + 3, 'text-anchor': 'end', class: 'tick' }); tx.textContent = fmtNum(v); svg.appendChild(tx) }
  const show = (x, y, text) => { tip.hidden = false; tip.textContent = text; const r = wrap.getBoundingClientRect(); tip.style.left = clamp(x / W * r.width, 40, r.width - 40) + 'px'; tip.style.top = Math.max(0, y / H * r.height - 30) + 'px' }
  const hide = () => { tip.hidden = true }
  if (kind === 'bar') {
    const pts = series[0].pts.slice(-40), bw = Math.min(44, (W - L - R) / pts.length), gap = Math.min(2, bw * 0.2), off = L + ((W - L - R) - bw * pts.length) / 2
    pts.forEach((p, i) => {
      const x = off + i * bw + gap / 2, w = Math.max(1, bw - gap), y0 = Y(0), y1 = Y(p.y), r = Math.min(4, w / 2, Math.abs(y0 - y1))
      const d = p.y >= 0 ? `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z` : `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`
      const bar = svgEl('path', { d, class: 'bar' }); svg.appendChild(bar)
      const hit = svgEl('rect', { x: off + i * bw, y: T, width: bw, height: H - T - B, fill: 'transparent' })
      hit.addEventListener('mouseenter', () => { bar.classList.add('on'); show(x + w / 2, Math.min(y0, y1), p.label + ': ' + fmtNum(p.y)) }); hit.addEventListener('mouseleave', () => { bar.classList.remove('on'); hide() })
      svg.appendChild(hit)
      if (pts.length <= 8) { const tx = svgEl('text', { x: x + w / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }); tx.textContent = trunc(p.label, Math.max(4, Math.floor(bw / 6))); svg.appendChild(tx) }
    })
  } else {
    const xs = all.map(p => +p.x), x0 = Math.min(...xs), x1 = Math.max(...xs), X = v => L + (W - L - R) * (x1 === x0 ? 0.5 : (v - x0) / (x1 - x0))
    series.forEach((s, k) => {
      if (!s.pts.length) return
      svg.appendChild(svgEl('path', { d: s.pts.map((p, i) => (i ? 'L' : 'M') + X(+p.x).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' '), class: 'line s' + (k + 1) }))
      if (series.length > 1) { const l = s.pts[s.pts.length - 1], tx = svgEl('text', { x: X(+l.x) + 4, y: Y(l.y) + 3, class: 'tick end' }); tx.textContent = trunc(s.name || 'series ' + (k + 1), 9); svg.appendChild(tx) }
    })
    for (const [v, a] of [[x0, 'start'], [x1, 'end']]) { const tx = svgEl('text', { x: X(v), y: H - 6, 'text-anchor': a, class: 'tick' }); tx.textContent = x1 > 1e11 ? fmtTime(v) : fmtNum(v); svg.appendChild(tx) }
    const cross = svgEl('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }), dots = series.map((s, k) => svgEl('circle', { r: 4, class: 'dot s' + (k + 1), visibility: 'hidden' }))
    svg.append(cross, ...dots)
    const hit = svgEl('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' })
    hit.addEventListener('mousemove', e => {
      const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W, near = series[0].pts.reduce((b, p) => Math.abs(X(+p.x) - vx) < Math.abs(X(+b.x) - vx) ? p : b, series[0].pts[0])
      cross.setAttribute('x1', X(+near.x)); cross.setAttribute('x2', X(+near.x)); cross.setAttribute('visibility', 'visible')
      const parts = series.map((s, k) => { const q = s.pts.find(p => +p.x === +near.x); if (q) { dots[k].setAttribute('cx', X(+q.x)); dots[k].setAttribute('cy', Y(q.y)); dots[k].setAttribute('visibility', 'visible') } else dots[k].setAttribute('visibility', 'hidden'); return q ? (series.length > 1 ? (s.name || 'series ' + (k + 1)) + ' ' : '') + fmtNum(q.y) : '' }).filter(Boolean)
      show(X(+near.x), Y(near.y), near.label + ' · ' + parts.join(' · '))
    })
    hit.addEventListener('mouseleave', () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); hide() })
    svg.appendChild(hit)
  }
  wrap.append(svg, tip)
  if (series.length > 1) wrap.appendChild(h('div.plegend', series.map((s, k) => h('span', h('i.s' + (k + 1)), s.name || 'series ' + (k + 1)))))
  return wrap
}
const fmtNum = v => typeof v !== 'number' ? String(v) : Math.abs(v) >= 10000 ? (v / 1000).toFixed(Math.abs(v) >= 100000 ? 0 : 1) + 'k' : Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)

// ---------- one panel, as a card ----------
function panelEl(P, p, { inline } = {}) {
  const card = h('div.panel' + (inline ? '.inline' : ''), { 'data-panel': p.id })
  const base = [], wl = []            // the card's listeners; the widgets' listeners (renewed on each paint)
  const paint = () => {
    wl.splice(0).forEach(f => f())
    const np = Panels.get(P, p.id); if (!np) { clear(card).appendChild(h('p.note', 'Panel "' + p.id + '" was removed.')); return } p = np
    clear(card)
    const waiting = Panels.waiting.get(p.id), run = Panels.runs.get(p.id), pv = Preview.count(p.id)
    card.appendChild(h('div.ph', h('b', p.spec.title || p.id), p.spec.description ? h('span.note', p.spec.description) : null, h('span.sp'),
      h('button.link.note', { title: 'Panel actions', on: { click: e => popMenu(e.currentTarget, [
        { label: p.pinned ? 'Unpin from the Panels tab' : 'Pin to the Panels tab', run: () => { p.pinned = !p.pinned; P.saveMeta(); App.ev.emit('panels', p.id); if (p.pinned) Dock.open('panels') } },
        { label: 'Show its definition', run: () => modal({ title: 'Panel "' + p.id + '"', wide: true, body: [h('pre.mono.yaml', { html: hlYAML(toYAML(p.spec)) })], actions: [{ label: 'Close' }] }) },
        { label: 'Remove', danger: true, run: () => Panels.remove(P, p.id) }], { right: true }) } }, '⋯')))
    const grid = h('div.pgrid')
    for (const it of p.spec.items) grid.appendChild(PANEL_CONTROLS.includes(it.type) ? controlEl(P, p, it) : widgetEl(P, p, it, wl))
    card.appendChild(grid)
    if (run) card.appendChild(h('div.prun' + (run.busy ? '' : run.ok ? '.ok' : '.bad'), h('b', run.label || 'button'), ' ', h('span.note', run.busy ? 'running…' : (run.ok ? 'done' : 'failed') + (run.fx ? ' · ' + run.fx : '')), run.busy ? null : h('pre.mono', run.out)))
    if (pv || waiting) card.appendChild(h('div.pfoot',
      pv ? [h('span.note', 'Previewing ' + plural(pv, 'value') + ' on the canvas, not in any file yet'), h('span.sp'),
        h('button.btn.sm', { on: { click: () => Preview.clear(p.id) } }, 'Reset'),
        h('button.btn.sm.primary', { title: 'Write the values into the CSS' + (App.ws !== 'main' ? ' of this proposal' : ''), on: { click: () => { const r = Panels.keep(P, p); toast('Kept ' + r.what.join(', ') + ' in ' + r.files.join(', ')) } } }, 'Keep')] : h('span.sp'),
      waiting ? [h('button.btn.sm', { on: { click: () => waiting.resolve(null) } }, 'Cancel'), h('button.btn.sm.primary', { on: { click: () => waiting.resolve(clone(p.values)) } }, waiting.label || 'Done')] : null))
  }
  const repaintSoon = debounce(() => { if (!card.contains(document.activeElement) || document.activeElement.type !== 'range') paint() }, 60)
  base.push(App.ev.on('panelvalue', id => { if (id === p.id) repaintSoon() }), App.ev.on('panels', id => { if (id === p.id) paint() }),
    App.ev.on('preview', () => paintFoot()), App.ev.on('ask', id => { if (id === p.id) paint() }))
  // only the footer depends on the preview; repainting the whole card mid-drag would drop the slider
  const paintFoot = () => { const has = !!card.querySelector('.pfoot'), want = Preview.count(p.id) > 0 || Panels.waiting.has(p.id); if (has !== want) paint(); else if (has) { const n = card.querySelector('.pfoot .note'); if (n) n.textContent = 'Previewing ' + plural(Preview.count(p.id), 'value') + ' on the canvas, not in any file yet' } }
  paint()
  // stop listening once the card leaves the page
  const mo = new MutationObserver(() => { if (!card.isConnected) { base.forEach(f => f()); wl.forEach(f => f()); mo.disconnect() } })
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0)
  return card
}
function controlEl(P, p, it) {
  const v = p.values[it.id], set = val => { try { Panels.set(P, p, it.id, val) } catch (e) { toast(e.message) } }
  const label = h('label.pl', it.label || it.id), out = h('span.pv')
  const show = val => { out.textContent = it.type === 'slider' ? fmtVal(val, it.bind && it.bind.unit || it.unit) : '' }
  let input
  const fill = (el, val) => el.style.setProperty('--p', ((val - it.min) / (it.max - it.min) * 100) + '%')
  if (it.type === 'slider') { input = h('input', { type: 'range', min: it.min, max: it.max, step: it.step || (it.max - it.min) / 100, value: v, on: { input: e => { fill(e.target, +e.target.value); show(+e.target.value); set(+e.target.value) } } }); fill(input, v); show(v) }
  else if (it.type === 'toggle') input = h('input', { type: 'checkbox', checked: !!v, on: { change: e => set(e.target.checked) } })
  else if (it.type === 'select') { input = h('select', { on: { change: e => { const o = Panels.options(P, it).find(o => String(o.value) === e.target.value); set(o ? o.value : e.target.value) } } }, Panels.options(P, it).map(o => h('option', { value: String(o.value), selected: String(o.value) === String(v) }, o.label))) }
  else if (it.type === 'text') input = h('input', { value: v ?? '', placeholder: it.placeholder || '', on: { change: e => set(e.target.value) } })
  else if (it.type === 'color') input = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(v) ? v : '#000000', on: { input: e => set(e.target.value) } })
  else if (it.type === 'button') return h('div.prow.btnrow', h('button.btn.sm', { disabled: !!(Panels.runs.get(p.id) || {}).busy, title: it.description || '', on: { click: () => Panels.run(P, p, it) } }, it.label || 'Run'), it.description ? h('span.note', it.description) : null)
  const bind = it.bind ? h('span.pb', { title: 'What this control changes' }, it.bind.css ? (() => { const m = it.bind.css[it.type === 'toggle' ? (v ? 'on' : 'off') : String(v)] || {}, n = Object.entries(m).reduce((a, [k, x]) => a + (k.startsWith('--') ? 1 : Object.keys(x).length), 0); return 'css: ' + plural(n, 'value') }) () : it.bind.cssVar ? it.bind.cssVar : it.bind.style ? it.bind.style.selector + ' ' + it.bind.style.prop : it.bind.store !== undefined ? 'store: ' + it.bind.store : it.bind.fixture ? 'fixture' : '') : null
  return h('div.prow', label, input, out, bind)
}
function widgetEl(P, p, it, offs) {   // offs collects the listeners, removed when the card repaints
  const box = h('div.pw' + (it.type === 'value' ? '.val' : ''))
  if (it.type === 'text' && !it.from) { box.appendChild(renderMarkdown(String(it.text || it.markdown || ''), f => P.read(f, 'main') !== null)); return box }
  let seq = 0
  const load = async () => {
    const my = ++seq
    let v, err
    try { v = await Streams.read(P, it.from, p) } catch (e) { err = e.message }
    if (my !== seq) return
    clear(box)
    if (it.label && it.type !== 'value') box.appendChild(h('div.pl', it.label))
    if (err) { box.appendChild(h('p.note', { style: { color: 'var(--accent)' } }, err)); return }
    if (it.type === 'value') box.append(h('div.big', typeof v === 'number' ? fmtNum(v) + (it.unit || '') : v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v)), h('div.pl', it.label || ''))
    else if (it.type === 'chart') box.appendChild(chartEl(v, it))
    else if (it.type === 'table') {
      if (Array.isArray(v) && !v.length) { box.appendChild(h('p.note', it.empty || 'Nothing yet.')); return }
      const rows = Array.isArray(v) ? v.slice(0, it.limit || 50) : v && typeof v === 'object' ? Object.entries(v).map(([key, value]) => ({ key, value })) : [{ value: v }]
      const cols = it.cols || [...new Set(rows.flatMap(r => r && typeof r === 'object' ? Object.keys(r) : ['value']))].slice(0, 8)
      box.appendChild(h('div.ptable', h('table.grid.ro', h('thead', h('tr', cols.map(c => h('th', c)))), h('tbody', rows.map(r => h('tr', cols.map(c => { const x = r && typeof r === 'object' ? r[c] : r; return h('td', x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : typeof x === 'number' ? fmtNum(x) : String(x)) })))))))
      if (Array.isArray(v) && v.length > rows.length) box.appendChild(h('div.note', '… ' + (v.length - rows.length) + ' more'))
    }
    else if (it.type === 'list') box.appendChild(h('ul.plist', (Array.isArray(v) ? v : [v]).slice(0, it.limit || 30).map(x => h('li', x && typeof x === 'object' ? (x.label ?? x.name ?? Object.values(x).filter(v => v != null && v !== '' && typeof v !== 'object').join(' · ')) + ((x.label ?? x.name) != null && x.value !== undefined ? ': ' + x.value : '') : String(x)))))
    else if (it.type === 'text') box.appendChild(renderMarkdown(String(v ?? ''), f => P.read(f, 'main') !== null))
  }
  const soon = debounce(load, it.from.eval || it.from.lib ? 400 : 150)
  for (const t of Streams.triggers(it.from)) offs.push(App.ev.on(t, (...a) => { if (t === 'panelvalue' && a[0] !== p.id) return; soon() }))
  offs.push(App.ev.on('ws', soon))
  box.appendChild(h('p.note', '…')); load()
  return box
}

// ---------- the Panels tab: pinned panels, and panels made from the Eval panel ----------
registerView('panels', {
  title: 'Panels', sub: 'controls and live values',
  make() {
    const body = h('div.scroll'), el = h('div', body)
    function paint() {
      clear(body); const P = App.P; if (!P) return
      const list = Panels.list(P).filter(p => p.pinned)
      body.appendChild(h('div.toolbar', h('b', 'Panels'), h('span.note', 'pinned from threads, or made in the Eval panel'), h('span.sp'),
        Preview.count() ? [h('span.note', 'Previewing ' + plural(Preview.count(), 'value')), h('button.btn.sm', { on: { click: () => Preview.clear() } }, 'Reset all')] : null))
      if (!list.length) body.appendChild(h('div.empty', h('p', 'No pinned panels.'), h('p.note', 'Ask Claude for one, for example: "give me sliders for the menu\'s font size and spacing, a toggle for the empty-menu fixture, and a chart of open orders by status". Panels show in the reply; pin one here from its ⋯ menu.')))
      for (const p of list.slice().reverse()) body.appendChild(panelEl(P, p))
    }
    const later = debounce(() => { if (Dock.visible('panels')) paint() }, 80)
    App.ev.on('panels', later); App.ev.on('project', () => { Preview.vars = {}; Preview.rules = {}; later() })
    return { el, show: paint }
  }
})
