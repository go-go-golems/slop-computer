// Scenario runs and fixtures on the test instance (frames/scenarios.js):
// they take turns, so overlapping runs each see their own fixture.
// node --test test/scenarios.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

globalThis.addEventListener ??= () => { } // server/instances.js watches visibility
const { Fixtures, runScenario } = await import('../src/frames/scenarios.js')
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
