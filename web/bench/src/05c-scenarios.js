// ---------- fixtures and scenarios ----------
// A fixture (fixtures/<name>.json) is a fixed set of rows, store values and a clock that a frame or a scenario
// runs against instead of the live data: { description, tables: { menu: [rows] | "live" }, store: {}, clock: "2026-05-01T08:30" }.
// A scenario (scenarios/<name>.json) is a list of steps run in a frame of its own, against a copy of the data:
// { description, page, size: [w, h], fixture, steps: [ { click }, { type, text }, { expect, text|count|visible|value }, … ] }
const SCEN_DIR = 'scenarios/', FIX_DIR = 'fixtures/'
const STEP_KINDS = ['go', 'click', 'type', 'waitFor', 'wait', 'expect', 'data', 'store', 'snapshot']

function fixtureList(P, ws) {
  return P.list(ws).filter(p => p.startsWith(FIX_DIR) && p.endsWith('.json')).map(path => {
    const name = path.slice(FIX_DIR.length, -5); let spec = null, error = null
    try { spec = JSON.parse(P.read(path, ws)) } catch (e) { error = e.message }
    return { name, path, spec, error, description: spec && spec.description || '', tables: spec && spec.tables ? Object.keys(spec.tables) : [], clock: spec && spec.clock || null }
  })
}
function checkFixture(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a fixture is an object: { tables: { name: [rows] }, store?: {}, clock?: "ISO time" }'
  for (const [n, v] of Object.entries(spec.tables || {})) if (v !== 'live' && !Array.isArray(v) && !(v && Array.isArray(v.rows))) return 'tables.' + n + ' must be a list of rows (or "live" to use the live table)'
  if (spec.clock && isNaN(new Date(spec.clock).getTime())) return 'clock must be a date and time, like "2026-05-01T08:30"'
  return null
}
function stepLabel(s) {
  if (!s || typeof s !== 'object') return String(s)
  if (s.go) return 'go ' + s.go
  if (s.click) return 'click ' + s.click
  if (s.type) return 'type "' + String(s.text ?? '').slice(0, 30) + '" into ' + s.type
  if (s.waitFor) return 'wait for ' + s.waitFor
  if (s.wait != null) return 'wait ' + s.wait + ' ms'
  if (s.expect) return 'expect ' + s.expect + (s.count != null ? ' count ' + s.count : '') + (s.text != null ? ' has "' + String(s.text).slice(0, 30) + '"' : '') + (s.value != null ? ' value "' + s.value + '"' : '') + (s.visible === false ? ' hidden' : '')
  if (s.data) return 'data ' + s.data + (s.where ? ' ' + JSON.stringify(s.where) : '') + (s.count != null ? ' count ' + s.count : '')
  if (s.store) return 'store ' + s.store + (s.count != null ? ' count ' + s.count : s.equals !== undefined ? ' = ' + JSON.stringify(s.equals) : '')
  if (s.snapshot != null) return 'snapshot' + (s.snapshot ? ' "' + s.snapshot + '"' : '')
  return JSON.stringify(s)
}
function checkScenario(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a scenario is an object: { page, steps: [...] }'
  if (!Array.isArray(spec.steps) || !spec.steps.length) return 'steps must be a non-empty list'
  for (const [i, s] of spec.steps.entries()) {
    const k = s && typeof s === 'object' ? STEP_KINDS.find(k => k in s) : null
    if (!k) return 'step ' + (i + 1) + ' (' + JSON.stringify(s) + ') has none of: ' + STEP_KINDS.join(', ')
    if (k === 'type' && s.text == null) return 'step ' + (i + 1) + ': type needs text'
    if (k === 'expect' && typeof s.expect !== 'string') return 'step ' + (i + 1) + ': expect is a selector'
  }
  if (spec.size && (!Array.isArray(spec.size) || spec.size.length !== 2)) return 'size is [width, height]'
  return null
}
function scenarioList(P, ws) {
  return P.list(ws).filter(p => p.startsWith(SCEN_DIR) && p.endsWith('.json')).map(path => {
    const name = path.slice(SCEN_DIR.length, -5); let spec = null, error = null
    try { spec = JSON.parse(P.read(path, ws)); error = checkScenario(spec) } catch (e) { error = 'not valid JSON: ' + e.message }
    return { name, path, spec, error, last: lastRun(P, name, ws) }
  })
}
const lastRun = (P, name, ws) => (P.meta.runs || {})[ws + '|' + name] || null

// run one scenario: a fresh isolated frame, the steps in order, a snapshot where it fails (and where asked)
async function runScenario(P, spec, { ws = 'main', name = 'unsaved', onStep, signal, who = 'you', thread, keep = true } = {}) {
  const bad = checkScenario(spec); if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
  const [w, hgt] = spec.size || [375, 720], t0 = now(), res = { name, ws, ok: true, steps: [], snaps: [], page: spec.page || 'index.html', fixture: spec.fixture || null, t: t0 }
  const fh = await Headless.fresh(P, res.page, ws, w, hgt, { fixture: spec.fixture })
  const timeout = s => clamp(+s.timeout || +spec.timeout || 2000, 100, 15000)
  const poll = async (s, test) => {             // checks retry until they pass or time out: pages render after data arrives
    const end = now() + timeout(s); let last
    while (true) { last = await test(); if (last.ok) return last; if (now() > end) return last; await sleep(60) }
  }
  const afterAction = async () => { await sleep(50); if (fh.loading) await fh.readyP; try { await fh.call('settle', [800], 2000) } catch { } }
  const snap = async label => { try { const m = await Snaps.take(P, fh, { label: label || null, by: who, note: 'scenario ' + name }); if (m) res.snaps.push({ id: m.id, label: label || '', route: fh.route }) } catch { } }
  try {
    for (const [i, s] of spec.steps.entries()) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { kind: 'cancelled' })
      const st = { i, label: stepLabel(s), ok: true }, ts = now()
      if (onStep) onStep({ ...st, running: true })
      try {
        if (s.go) { fh.navigate(s.go); await fh.readyP; await afterAction() }
        else if (s.click) { await poll(s, async () => ({ ok: (await fh.call('count', [s.click])) > 0 })); await fh.call('click', [s.click]); await afterAction() }
        else if (s.type) { await poll(s, async () => ({ ok: (await fh.call('count', [s.type])) > 0 })); await fh.call('type', [s.type, String(s.text)]); await afterAction() }
        else if (s.waitFor) await fh.call('waitFor', [s.waitFor, timeout(s)], timeout(s) + 1000)
        else if (s.wait != null) await sleep(clamp(+s.wait || 0, 0, 10000))
        else if (s.expect) {
          const r = await poll(s, async () => {
            const n = await fh.call('count', [s.expect])
            if (s.count != null) return { ok: n === +s.count, got: 'count ' + n }
            if (s.visible === false) { if (!n) return { ok: true }; const [el] = await fh.call('all', [s.expect, 1]); return { ok: !el.rect.w || !el.rect.h, got: 'visible ' + el.rect.w + '×' + el.rect.h } }
            if (!n) return { ok: false, got: 'nothing matches' }
            const els = await fh.call('all', [s.expect, 20])
            if (s.text != null) { const want = String(s.text).toLowerCase(); const hit = els.find(e => e.text.toLowerCase().includes(want)); return { ok: !!hit, got: 'text "' + els.map(e => e.text).join(' | ').slice(0, 120) + '"' } }
            if (s.value != null) { const v = (els[0].attrs || {}).value; return { ok: String(v) === String(s.value), got: 'value "' + v + '"' } }
            const vis = els.find(e => e.rect.w && e.rect.h); return { ok: !!vis, got: 'not visible' }
          })
          if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s).slice(7) + ', got ' + r.got), { kind: 'verify' })
        }
        else if (s.data) {
          const r = await poll(s, async () => {
            const t = fh.fx && fh.fx.tables[s.data]; if (!t) return { ok: false, got: 'no table ' + s.data }
            const rows = s.where ? t.rows.filter(x => Object.entries(s.where).every(([k, v]) => x[k] === v)) : t.rows
            if (s.count != null) return { ok: rows.length === +s.count, got: rows.length + ' rows' }
            return { ok: rows.length > 0, got: '0 rows' }
          })
          if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s) + ', got ' + r.got), { kind: 'verify' })
        }
        else if (s.store) {
          const r = await poll(s, async () => {
            const v = fh.fx ? fh.fx.store[s.store] : undefined
            if (s.count != null) { const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0; return { ok: n === +s.count, got: n + ' entries' } }
            if (s.equals !== undefined) return { ok: JSON.stringify(v) === JSON.stringify(s.equals), got: JSON.stringify(v) }
            return { ok: v !== undefined, got: 'nothing' }
          })
          if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s) + ', got ' + r.got), { kind: 'verify' })
        }
        else if (s.snapshot != null) await snap(s.snapshot || 'step ' + (i + 1))
      } catch (e) {
        st.ok = false; st.error = e.message.replace(/ in frame [^ ]+$/, ''); st.kind = e.kind || 'error'
      }
      st.ms = now() - ts; st.route = fh.route
      const errs = fh.logs.filter(l => l.level === 'error' && l.t >= ts && !l.keep)
      if (errs.length) st.errors = errs.map(l => l.text).slice(0, 3)
      res.steps.push(st); if (onStep) onStep(st)
      if (!st.ok) { res.ok = false; res.failedAt = i; await snap(null); break }
    }
    if (res.ok && keep && !res.snaps.length) await snap(null)
  } finally { fh.dispose() }
  res.ms = now() - t0
  if (keep && name !== 'unsaved') {
    P.meta.runs = P.meta.runs || {}
    P.meta.runs[ws + '|' + name] = { t: res.t, ok: res.ok, ms: res.ms, failedAt: res.failedAt, steps: res.steps.map(s => ({ label: s.label, ok: s.ok, error: s.error, ms: s.ms })), snaps: res.snaps }
    P.saveMeta()
  }
  P.log({ kind: 'scenario', who, ws, thread, name, ok: res.ok, note: name + (res.ok ? ' passed (' + plural(res.steps.length, 'step') + ')' : ' failed at step ' + (res.failedAt + 1) + ': ' + res.steps[res.failedAt].error) })
  App.ev.emit('scenarios', name)
  return res
}
async function runAllScenarios(P, opts = {}) {
  const ws = opts.ws || 'main', out = []
  for (const s of scenarioList(P, ws)) {
    if (opts.signal && opts.signal.aborted) break
    if (s.error) { out.push({ name: s.name, ok: false, error: s.error }); continue }
    const r = await runScenario(P, s.spec, { ...opts, ws, name: s.name })
    out.push({ name: s.name, ok: r.ok, failedAt: r.failedAt, error: r.ok ? undefined : r.steps[r.failedAt].error, ms: r.ms })
  }
  return out
}
const scenarioSummary = r => r.ok ? '✓ ' + r.name + ' (' + plural(r.steps.length, 'step') + ', ' + r.ms + ' ms)' : '✗ ' + r.name + ' at step ' + (r.failedAt + 1) + ' (' + r.steps[r.failedAt].label + '): ' + r.steps[r.failedAt].error

// ---------- recording: interact with a frame, get a scenario ----------
Object.assign(FrameHost.prototype, {
  async startRecording(fr) {
    this.rec = { steps: [], page: this.route, size: [this.w, this.h], fixture: this.fixture || null, fid: fr ? fr.id : null, t: now() }
    this.isolate = true; this.fx = null
    await this.load({ keepState: false }); this.ev.emit('rec', this.rec)
  },
  recStep(step) {
    const r = this.rec; if (!r || !step) return
    const last = r.steps[r.steps.length - 1]
    if (step.type && last && last.type === step.type) last.text = step.text           // typing into the same field: keep the final text
    else if (step.expect && last && last.expect === step.expect) Object.assign(last, step)
    else r.steps.push(step)
    this.ev.emit('rec', r)
  },
  async stopRecording() {
    const r = this.rec; this.rec = null; this.isolate = false; this.fx = null
    if (r) this.route = r.page; this.saved = null
    await this.load({ keepState: false }); this.ev.emit('nav', this.route); this.ev.emit('rec', null)
    return r
  }
})
async function saveRecording(P, r, ws) {
  if (!r || !r.steps.length) { toast('Nothing was recorded'); return null }
  const name = await promptBox('Save scenario', 'Recorded ' + plural(r.steps.length, 'step') + ' starting on ' + r.page + '. Name:', r.page.replace(/\.html?$/, '').replace(/[^\w-]/g, '-') + '-flow'); if (!name) return null
  const slug = name.trim().replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'scenario'
  const spec = { description: '', page: r.page, size: r.size, ...(r.fixture ? { fixture: r.fixture } : {}), steps: r.steps }
  P.write(SCEN_DIR + slug + '.json', JSON.stringify(spec, null, 2) + '\n', { ws, who: 'you', note: 'recorded scenario' })
  toast('Saved ' + SCEN_DIR + slug + '.json'); Dock.open('scenarios')
  return slug
}
