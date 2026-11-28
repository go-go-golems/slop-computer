// Scenario runs and fixtures on the test instance (frames/scenarios.js):
// they take turns, so overlapping runs each see their own fixture.
// node --test test/scenarios.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.addEventListener ??= () => { } // server/instances.js watches visibility
const { Fixtures, runScenario, expectStep } = await import('../src/frames/scenarios.js')
const { Slop } = await import('../src/server/slop.js')
const { Headless } = await import('../src/frames/host.js')
const { sleep } = await import('../src/lib/util.js')

// The server's side of one person's test instance: reset drops its rows,
// seed fills them, sql counts them (slowly, so runs can overlap).
function fakeServer() {
  const s = { rows: [], log: [] }
  Slop.call = async (action, args) => {
    s.log.push(action)
    await sleep(5)
    switch (action) {
      case 'reset': s.rows = []; return { dropped: 'x-test' }
      case 'instance': return { id: 'x-test', kind: 'test', ref: args.ref || 'draft', n: 1, broken: '' }
      case 'seed': s.rows = [...args.tables.notes]; return {}
      case 'sql': await sleep(20); return s.rows
      default: throw new Error('unexpected ' + action)
    }
  }
  Headless.fresh = async (P, route) => ({ route, logs: [], loading: false, call: async () => 0, navigate: async () => { }, dispose() { } })
  return s
}
const fixture = n => JSON.stringify({ tables: { notes: Array.from({ length: n }, (_, i) => ({ id: 'n' + i })) } })
const P = {
  app: 'x', meta: {}, saveMeta() { }, log() { },
  read: path => ({ 'fixtures/one.json': fixture(1), 'fixtures/two.json': fixture(2) })[path] ?? null,
}
const spec = (fix, n) => ({ fixture: fix, steps: [{ wait: 10 }, { sql: 'SELECT * FROM notes', count: n, timeout: 100 }] })

test('overlapping runs take turns on the test instance', async () => {
  const s = fakeServer()
  const [a, b] = await Promise.all([
    runScenario(P, spec('one', 1), { name: 'a', keep: false }),
    runScenario(P, spec('two', 2), { name: 'b', keep: false }),
  ])
  assert.ok(a.ok, 'a: ' + JSON.stringify(a.steps))
  assert.ok(b.ok, 'b: ' + JSON.stringify(b.steps))
  // each run's reset, seed and checks come before the next run's reset
  const resets = s.log.flatMap((x, i) => x === 'reset' ? [i] : [])
  assert.equal(resets.length, 2)
  assert.ok(s.log.slice(0, resets[1]).includes('sql'), 'the first run checked before the second reset: ' + s.log.join(' '))
})

test('a fixture applied during a run waits for it; a failed run lets the next one go', async () => {
  const s = fakeServer()
  const run = runScenario(P, spec('two', 1), { name: 'fails', keep: false })   // two rows, expects one
  const applied = Fixtures.apply(P, 'one')
  const r = await run
  assert.equal(r.ok, false)
  assert.deepEqual(await applied, { fixture: 'one', ws: 'draft' })
  assert.equal(s.rows.length, 1, 'the fixture applied after the run, not under it')
  assert.ok((await runScenario(P, spec('one', 1), { name: 'next', keep: false })).ok)
})

// A text check is "contains"; a number wants exact or match ("12" is
// contained in "128": a persona review found a check passing on the wrong
// number).
test('expect: text contains, exact and match', async () => {
  const long = 'Row '.repeat(60) + 'Shipped: 128 kg'   // past info's 120 characters
  const fh = { call: async (m) => (m === 'count' ? 1 : m === 'texts' ? ['  Shipped:\n 128 kg '] : [{ text: '  Shipped:\n 128 kg ', rect: { w: 10, h: 10 } }]) }
  const deep = { call: async (m) => (m === 'count' ? 1 : m === 'texts' ? [long] : [{ text: long.slice(0, 120), rect: { w: 10, h: 10 } }]) }
  assert.equal((await expectStep(deep, { expect: 'table', text: '128 kg' })).ok, true, 'text past the first 120 characters')
  const old = { call: async (m) => { if (m === 'texts') throw new Error('unknown'); return m === 'count' ? 1 : [{ text: 'Shipped: 128 kg', rect: { w: 1, h: 1 } }] } }
  assert.equal((await expectStep(old, { expect: '#w', text: '128' })).ok, true, 'an older probe without texts')
  assert.equal((await expectStep(fh, { expect: '#w', text: '12' })).ok, true)
  assert.equal((await expectStep(fh, { expect: '#w', text: '12 kg', exact: true })).ok, false)
  assert.equal((await expectStep(fh, { expect: '#w', text: 'shipped: 128 KG', exact: true })).ok, true)
  assert.equal((await expectStep(fh, { expect: '#w', match: '\\b12 kg' })).ok, false)
  assert.equal((await expectStep(fh, { expect: '#w', match: '\\b128 kg' })).ok, true)
  assert.match((await expectStep(fh, { expect: '#w', match: '(' })).got, /not a regular expression/)
})

// A key a step's kind does not take fails the scenario's check, naming the
// keys it does take (an unknown key was ignored: a misspelled check never ran).
test('checkScenario: unknown step keys', async () => {
  const { checkScenario } = await import('../src/core/scenario.js')
  const sc = steps => checkScenario({ page: 'index.html', steps })
  assert.equal(sc([{ expect: '#n', text: '12', exact: true }, { sql: 'SELECT 1', value: 1, timeout: 500 }]), null)
  assert.match(sc([{ expect: '#n', equals: '12' }]), /step 1 \(expect\): unknown key equals; a expect step takes expect, text, exact, match/)
  assert.match(sc([{ click: 'b' }, { sql: 'SELECT 1', equal: 1, nme: 'x' }]), /step 2 \(sql\): unknown keys equal, nme/)
  assert.match(sc([{ expect: '#n', match: '(' }]), /match is not a regular expression/)
})

test('scenarioList: a result from before an edit is stale', async () => {
  const { scenarioList, specKey } = await import('../src/core/scenario.js')
  const spec = { page: 'index.html', steps: [{ expect: 'h1', text: 'Hi' }] }
  let text = JSON.stringify(spec)
  const P = { list: () => ['scenarios/a.json'], read: () => text, meta: { runs: { 'draft|a': { key: specKey(spec), ok: true, t: 1, steps: [] } } } }
  assert.equal(scenarioList(P, 'draft')[0].last.stale, undefined, 'unchanged: the result stands')
  text = JSON.stringify({ ...spec, steps: [{ expect: 'h1', text: 'Bye' }] })
  assert.equal(scenarioList(P, 'draft')[0].last.stale, true, 'edited: stale')
  P.meta.runs['draft|a'] = { ok: true, t: 1, steps: [] }
  assert.equal(scenarioList(P, 'draft')[0].last.stale, undefined, 'an older run without a key is not marked')
})

test('checkScenario: a download step', async () => {
  const { checkScenario, stepLabel } = await import('../src/core/scenario.js')
  assert.equal(checkScenario({ page: 'index.html', steps: [{ click: '#export' }, { download: 'inventory.csv', text: 'ID,Nm', exact: true }] }), null)
  assert.match(checkScenario({ page: 'index.html', steps: [{ download: 1 }] }), /download is the file name/)
  assert.match(checkScenario({ page: 'index.html', steps: [{ download: '', match: '([' }] }), /not a regular expression/)
  assert.match(checkScenario({ page: 'index.html', steps: [{ download: '', count: 2 }] }), /unknown key count/)
  assert.equal(stepLabel({ download: 'a.csv', text: 'x', exact: true }), 'download a.csv is exactly "x"')
})
