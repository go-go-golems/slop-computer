// frames/scenarios.js — running scenarios, and the fixtures they start from,
// on the person's test instance.
//
// The test instance runs the workspace's code (draft, or a proposal) on
// data of its own. Before a scenario runs, the instance is reset (dropped
// and made again, so its migrations run on empty tables) and seeded with
// the scenario's fixture, if it names one; then the steps run in a fresh
// headless frame of it. Fixtures.current says which fixture the instance
// holds now (canvas frames of the test instance show that). Runs and
// fixtures take turns on the instance: each holds it from its reset to its
// last step.
//
// Owns: the test instance's state. Public API: Fixtures (current, apply),
// runScenario, runAllScenarios, scenarioSummary. Specs: core/scenario.js.
import { FrameHosts, Headless } from './host.js';
import { Instances } from '../server/instances.js';
import { Slop } from '../server/slop.js';
import { Snaps } from './layout.js';
import { checkFixture, checkScenario, fixturePath, scenarioList, specKey, stepLabel } from '../core/scenario.js';
import { clamp, emitter, lock, now, plural, sleep } from '../lib/util.js';

// The test instance is one per person and app, and a scenario run or a
// fixture applied resets it, so they take turns: a proposal card's check,
// the scenarios panel and an agent's tests.* calls can overlap, and each
// would otherwise run on the others' data or code.
const turns = new Map()   // app → lock
function onTestInstance(P, fn) {
  if (!turns.has(P.app)) turns.set(P.app, lock())
  return turns.get(P.app).run(fn)
}

export const Fixtures = {
  current: null, ev: emitter(),
  // Reset the test instance of ws to a fixture's data (null: empty). read:
  // how to read the fixture file (default: the person's view of ws; an eval
  // passes its transaction's, which has its own writes).
  apply(P, name, ws = 'draft', read) {
    return onTestInstance(P, () => applyFixture(P, name, ws, read))
  }
}
// Fixtures.apply, by a caller that holds the test instance.
async function applyFixture(P, name, ws, read = path => P.read(path, ws)) {
  let spec = null
  if (name) {
    const text = read(fixturePath(name))
    if (text === null) throw Object.assign(new Error('no fixture ' + fixturePath(name)), { kind: 'missing' })
    spec = JSON.parse(text)
    const bad = checkFixture(spec)
    if (bad) throw Object.assign(new Error(fixturePath(name) + ': ' + bad), { kind: 'invalid' })
  }
  await Instances.reset(P, 'test')
  await Instances.ensure(P, 'test', ws === 'draft' ? undefined : ws)
  if (spec) await Slop.call('seed', { app: P.app, kind: 'test', docs: spec.docs || {}, tables: spec.tables || {} })
  Fixtures.current = name || null
  for (const fh of FrameHosts) if (fh.project === P && fh.kind === 'test') fh.load({ keepState: false })
  Fixtures.ev.emit('applied', Fixtures.current)
  return { fixture: Fixtures.current, ws }
}

// Run one scenario: reset and seed the test instance, a fresh frame of it,
// the steps in order, a snapshot where it fails (and where asked). It waits
// its turn on the test instance.
export async function runScenario(P, spec, opts = {}) {
  const bad = checkScenario(spec)
  if (bad) throw Object.assign(new Error(bad), { kind: 'invalid' })
  return onTestInstance(P, () => {
    if (opts.signal && opts.signal.aborted) throw Object.assign(new Error('cancelled'), { kind: 'cancelled' })
    return runHolding(P, spec, opts)
  })
}
// runScenario's run, while it holds the test instance.
async function runHolding(P, spec, { ws = 'draft', name = 'unsaved', onStep, signal, who = 'you', thread, keep = true, read } = {}) {
  const [w, hgt] = spec.size || [375, 720], t0 = now()
  const res = { name, ws, ok: true, steps: [], snaps: [], page: spec.page || 'index.html', fixture: spec.fixture || null, t: t0 }
  await applyFixture(P, spec.fixture || null, ws, read)
  const fh = await Headless.fresh(P, res.page, { kind: 'test', ref: ws === 'draft' ? null : ws, w, h: hgt })
  const timeout = s => clamp(+s.timeout || +spec.timeout || 2000, 100, 15000)
  // checks retry until they pass or time out: pages render after data arrives
  const poll = async (s, test) => {
    const end = now() + timeout(s)
    for (; ;) { const last = await test(); if (last.ok || now() > end) return last; await sleep(60) }
  }
  const afterAction = async () => { await sleep(50); if (fh.loading) await fh.readyP; try { await fh.call('settle', [800], 2000) } catch { } }
  const snap = async label => {
    try {
      const m = await Snaps.take(P, fh, { label: label || null, by: who, note: 'scenario ' + name })
      if (m) res.snaps.push({ id: m.id, label: label || '', route: fh.route })
    } catch { }
  }
  const verify = (s, r) => { if (!r.ok) throw Object.assign(new Error('expected ' + stepLabel(s) + ', got ' + r.got), { kind: 'verify' }) }
  try {
    for (const [i, s] of spec.steps.entries()) {
      if (signal && signal.aborted) throw Object.assign(new Error('cancelled'), { kind: 'cancelled' })
      const st = { i, label: stepLabel(s), ok: true }, ts = now()
      if (onStep) onStep({ ...st, running: true })
      try {
        if (s.go) { await fh.navigate(s.go); await afterAction() }
        else if (s.click) { await poll(s, async () => ({ ok: (await fh.call('count', [s.click])) > 0 })); await fh.call('click', [s.click]); await afterAction() }
        else if (s.type) { await poll(s, async () => ({ ok: (await fh.call('count', [s.type])) > 0 })); await fh.call('type', [s.type, String(s.text)]); await afterAction() }
        else if (s.waitFor) await fh.call('waitFor', [s.waitFor, timeout(s)], timeout(s) + 1000)
        else if (s.wait != null) await sleep(clamp(+s.wait || 0, 0, 10000))
        else if (s.expect) verify(s, await poll(s, () => expectStep(fh, s)))
        else if (s.sql) verify(s, await poll(s, async () => {
          const rows = await Slop.call('sql', { app: P.app, kind: 'test', query: s.sql, args: s.args || [] })
          const list = Array.isArray(rows) ? rows : [], n = list.length
          // value: the first column of the first row (numbers compared as numbers); rows: exactly these rows
          if (s.value !== undefined) {
            const v = n ? Object.values(list[0])[0] : undefined
            const same = typeof s.value === 'number' && v != null ? Number(v) === s.value : JSON.stringify(v) === JSON.stringify(s.value)
            return { ok: same, got: n ? JSON.stringify(v) : 'no rows' }
          }
          if (s.rows) return { ok: JSON.stringify(list) === JSON.stringify(s.rows), got: JSON.stringify(list).slice(0, 160) }
          return s.count != null ? { ok: n === +s.count, got: n + ' rows' } : { ok: n > 0, got: '0 rows' }
        }))
        else if (s.download != null) verify(s, await poll(s, async () => {
          const d = await fh.call('download', [])
          if (!d) return { ok: false, got: 'no download yet' }
          if (s.download && d.name !== s.download) return { ok: false, got: 'downloaded "' + d.name + '"' }
          const t = d.text == null ? '' : String(d.text)
          const ok = s.exact ? t === String(s.text) : s.match != null ? new RegExp(String(s.match)).test(t) : s.text != null ? t.includes(String(s.text)) : true
          return { ok, got: 'downloaded "' + d.name + '": ' + JSON.stringify(t.slice(0, 120)) }
        }))
        else if (s.docs) verify(s, await poll(s, async () => {
          const docs = (await Slop.call('docs', { app: P.app, kind: 'test', coll: s.docs })).map(d => d.body || {})
          const hits = s.where ? docs.filter(d => Object.entries(s.where).every(([k, v]) => d[k] === v)) : docs
          return s.count != null ? { ok: hits.length === +s.count, got: hits.length + ' documents' } : { ok: hits.length > 0, got: '0 documents' }
        }))
        else if (s.snapshot != null) await snap(s.snapshot || 'step ' + (i + 1))
      } catch (e) {
        st.ok = false; st.error = e.message.replace(/ in frame [^ ]+$/, ''); st.kind = e.kind || 'error'
      }
      st.ms = now() - ts; st.route = fh.route
      const errs = fh.logs.filter(l => l.level === 'error' && l.t >= ts && !l.keep)
      if (errs.length) st.errors = errs.map(l => l.text).slice(0, 3)
      res.steps.push(st)
      if (onStep) onStep(st)
      if (!st.ok) { res.ok = false; res.failedAt = i; await snap(null); break }
    }
    if (res.ok && keep && !res.snaps.length) await snap(null)
  } finally { fh.dispose() }
  res.ms = now() - t0
  if (keep && name !== 'unsaved') {
    P.meta.runs = P.meta.runs || {}
    P.meta.runs[ws + '|' + name] = { key: specKey(spec), t: res.t, ok: res.ok, ms: res.ms, failedAt: res.failedAt, steps: res.steps.map(s => ({ label: s.label, ok: s.ok, error: s.error, ms: s.ms })), snaps: res.snaps }
    P.saveMeta()
  }
  const note = name + (res.ok ? ' passed (' + plural(res.steps.length, 'step') + ')' : ' failed at step ' + (res.failedAt + 1) + ': ' + res.steps[res.failedAt].error)
  P.log({ kind: 'scenario', who, ref: ws, thread, name, ok: res.ok, note })
  return res
}
export async function expectStep(fh, s) {
  const n = await fh.call('count', [s.expect])
  if (s.count != null) return { ok: n === +s.count, got: 'count ' + n }
  if (s.visible === false) {
    if (!n) return { ok: true }
    const [el] = await fh.call('all', [s.expect, 1])
    return { ok: !el.rect.w || !el.rect.h, got: 'visible ' + el.rect.w + '×' + el.rect.h }
  }
  if (!n) return { ok: false, got: 'nothing matches' }
  const els = await fh.call('all', [s.expect, 20])
  // text and match read each match's whole text (all() cuts it at 120 characters; an older probe has no texts)
  const texts = s.text != null || s.match != null ? await fh.call('texts', [s.expect, 20]).catch(() => els.map(e => e.text)) : []
  const got = () => 'text "' + texts.join(' | ').slice(0, 160) + '"'
  // text: contains, ignoring case ("12" passes on "128": a number wants exact or match);
  // exact: the whole text, spaces collapsed; match: a regular expression
  if (s.match != null) {
    let re
    try { re = new RegExp(String(s.match)) } catch (e) { return { ok: false, got: 'match is not a regular expression: ' + e.message } }
    return { ok: texts.some(t => re.test(t)), got: got() }
  }
  if (s.text != null) {
    const norm = t => String(t).replace(/\s+/g, ' ').trim().toLowerCase(), want = norm(s.text)
    return { ok: texts.some(t => s.exact ? norm(t) === want : t.toLowerCase().includes(String(s.text).toLowerCase())), got: got() }
  }
  if (s.value != null) { const v = (els[0].attrs || {}).value; return { ok: String(v) === String(s.value), got: 'value "' + v + '"' } }
  return { ok: els.some(e => e.rect.w && e.rect.h), got: 'not visible' }
}

// opts.files: where the scenarios are read ({list, read, meta}; default: the project)
export async function runAllScenarios(P, opts = {}) {
  const ws = opts.ws || 'draft', out = []
  for (const s of scenarioList(opts.files || P, ws)) {
    if (opts.signal && opts.signal.aborted) break
    if (s.error) { out.push({ name: s.name, ok: false, error: s.error }); continue }
    const r = await runScenario(P, s.spec, { ...opts, ws, name: s.name })
    out.push({ name: s.name, ok: r.ok, failedAt: r.failedAt, error: r.ok ? undefined : r.steps[r.failedAt].error, ms: r.ms })
  }
  return out
}
export const scenarioSummary = r => r.ok
  ? '✓ ' + r.name + ' (' + plural(r.steps.length, 'step') + ', ' + r.ms + ' ms)'
  : '✗ ' + r.name + ' at step ' + (r.failedAt + 1) + ' (' + r.steps[r.failedAt].label + '): ' + r.steps[r.failedAt].error
