// core/scenario.js — fixtures and scenarios as specs: their files, their
// checks, how a step reads.
//
// A fixture (fixtures/<name>.json) is the data a test instance starts from:
//   { description, docs: { coll: [rows] }, tables: { name: [rows] } }
// (docs: documents of the app's db, by collection; tables: rows of its SQL
// tables). A scenario (scenarios/<name>.json) is a list of steps run in a
// frame of the person's test instance, after it was reset and seeded:
//   { description, page, size: [w, h], fixture, steps: [ { click }, { type, text },
//     { expect, text [exact]|match|count|visible|value }, { sql, count|value|rows }, { docs, where, count }, … ] }
// Both are files of the app: they are committed, reviewed and proposed like
// code. Running them is frames/scenarios.js.
//
// Public API: SCEN_DIR, FIX_DIR, STEP_KINDS, fixturePath, checkFixture,
// checkScenario, stepLabel, fixtureList, scenarioList. No DOM, no network.

export const SCEN_DIR = 'scenarios/', FIX_DIR = 'fixtures/'
export const STEP_KINDS = ['go', 'click', 'type', 'waitFor', 'wait', 'expect', 'sql', 'docs', 'snapshot']
// The keys each kind of step takes (besides timeout and note, which any
// step may have). A key that is not one of them fails the check: an
// unknown key was ignored, so a misspelled check never ran.
export const STEP_KEYS = {
  go: ['go'], click: ['click'], type: ['type', 'text'], waitFor: ['waitFor'], wait: ['wait'],
  expect: ['expect', 'text', 'exact', 'match', 'count', 'visible', 'value'],
  sql: ['sql', 'args', 'count', 'value', 'rows'], docs: ['docs', 'where', 'count'], snapshot: ['snapshot'],
}
const ANY_STEP = ['timeout', 'note']
export const fixturePath = name => FIX_DIR + String(name).replace(/\.json$/, '') + '.json'

export function checkFixture(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a fixture is an object: { docs?: { coll: [rows] }, tables?: { name: [rows] } }'
  for (const part of ['docs', 'tables']) {
    const v = spec[part]
    if (v === undefined) continue
    if (!v || typeof v !== 'object' || Array.isArray(v)) return part + ' is an object of lists of rows'
    for (const [n, rows] of Object.entries(v)) if (!Array.isArray(rows) || rows.some(r => !r || typeof r !== 'object')) return part + '.' + n + ' must be a list of objects'
  }
  return null
}

export function checkScenario(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return 'a scenario is an object: { page, steps: [...] }'
  if (!Array.isArray(spec.steps) || !spec.steps.length) return 'steps must be a non-empty list'
  for (const [i, s] of spec.steps.entries()) {
    const k = s && typeof s === 'object' ? STEP_KINDS.find(k => k in s) : null
    if (!k) return 'step ' + (i + 1) + ' (' + JSON.stringify(s) + ') has none of: ' + STEP_KINDS.join(', ')
    if (k === 'type' && s.text == null) return 'step ' + (i + 1) + ': type needs text'
    if (k === 'expect' && typeof s.expect !== 'string') return 'step ' + (i + 1) + ': expect is a selector'
    if (k === 'sql' && typeof s.sql !== 'string') return 'step ' + (i + 1) + ': sql is a query'
    if (k === 'docs' && typeof s.docs !== 'string') return 'step ' + (i + 1) + ': docs is a collection'
    const extra = Object.keys(s).filter(x => !STEP_KEYS[k].includes(x) && !ANY_STEP.includes(x))
    if (extra.length) return 'step ' + (i + 1) + ' (' + k + '): unknown ' + (extra.length > 1 ? 'keys ' : 'key ') + extra.join(', ') + '; a ' + k + ' step takes ' + STEP_KEYS[k].join(', ') + ' (and timeout, note)'
    if (k === 'expect' && s.match != null) { try { new RegExp(String(s.match)) } catch (e) { return 'step ' + (i + 1) + ': match is not a regular expression: ' + e.message } }
  }
  if (spec.size && (!Array.isArray(spec.size) || spec.size.length !== 2)) return 'size is [width, height]'
  return null
}

export function stepLabel(s) {
  if (!s || typeof s !== 'object') return String(s)
  const count = s.count != null ? ' count ' + s.count : ''
  if (s.go) return 'go ' + s.go
  if (s.click) return 'click ' + s.click
  if (s.type) return 'type "' + String(s.text ?? '').slice(0, 30) + '" into ' + s.type
  if (s.waitFor) return 'wait for ' + s.waitFor
  if (s.wait != null) return 'wait ' + s.wait + ' ms'
  if (s.expect) {
    return 'expect ' + s.expect + count + (s.text != null ? ' has "' + String(s.text).slice(0, 30) + '"' : '') +
      (s.exact ? ' (exactly)' : '') + (s.match != null ? ' matches /' + s.match + '/' : '') +
      (s.value != null ? ' value "' + s.value + '"' : '') + (s.visible === false ? ' hidden' : '')
  }
  if (s.sql) return 'sql ' + s.sql.slice(0, 60) + count + (s.value !== undefined ? ' = ' + JSON.stringify(s.value) : '') + (s.rows ? ' rows ' + JSON.stringify(s.rows).slice(0, 60) : '')
  if (s.docs) return 'docs ' + s.docs + (s.where ? ' ' + JSON.stringify(s.where) : '') + count
  if (s.snapshot != null) return 'snapshot' + (s.snapshot ? ' "' + s.snapshot + '"' : '')
  return JSON.stringify(s)
}

// The fixtures and scenarios in a workspace's files (P.list/P.read), each
// with its spec or why it does not parse.
export function fixtureList(P, ws) {
  return P.list(ws).filter(p => p.startsWith(FIX_DIR) && p.endsWith('.json')).map(path => {
    const name = path.slice(FIX_DIR.length, -5)
    let spec = null, error = null
    try { spec = JSON.parse(P.read(path, ws)); error = checkFixture(spec) } catch (e) { error = 'not valid JSON: ' + e.message }
    const parts = spec && !error ? [...Object.keys(spec.docs || {}).map(c => 'docs ' + c), ...Object.keys(spec.tables || {}).map(t => 'table ' + t)] : []
    return { name, path, spec, error, description: spec && spec.description || '', parts }
  })
}
export function scenarioList(P, ws) {
  return P.list(ws).filter(p => p.startsWith(SCEN_DIR) && p.endsWith('.json')).map(path => {
    const name = path.slice(SCEN_DIR.length, -5)
    let spec = null, error = null
    try { spec = JSON.parse(P.read(path, ws)); error = checkScenario(spec) } catch (e) { error = 'not valid JSON: ' + e.message }
    return { name, path, spec, error, last: (P.meta.runs || {})[ws + '|' + name] || null }
  })
}
