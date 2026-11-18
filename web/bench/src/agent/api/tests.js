// agent/api/tests.js — fixtures.* and scenarios.*: the app's tests, as files.
//
// fixtures/<name>.json and scenarios/<name>.json are files of the app (their
// specs: core/scenario.js), written through the eval's transaction like any
// other. A run resets the person's test instance of the workspace, seeds it
// with the scenario's fixture and runs the steps in a fresh frame of it
// (frames/scenarios.js); it runs the committed code, so write in one eval
// and run in the next.
//
// Public API: TESTS (an API table).
import { Fixtures, runAllScenarios, runScenario } from '../../frames/scenarios.js';
import { SCEN_DIR, checkFixture, checkScenario, fixtureList, fixturePath, scenarioList } from '../../core/scenario.js';
import { Slop } from '../../server/slop.js';
import { missing } from './files.js';

const invalid = msg => Object.assign(new Error(msg), { kind: 'invalid' })
// the eval's files, as fixtureList and scenarioList read them
const files = ctx => ({ list: () => ctx.tx.list(), read: path => ctx.tx.read(path), meta: ctx.project.meta })
const fileName = name => String(name).replace(/\.json$/, '').replace(/[^\w-]/g, '-')
const save = (ctx, path, spec) => ctx.tx.write(path, JSON.stringify(spec, null, 2) + '\n')
const read = (ctx, name) => {
  const s = scenarioList(files(ctx), ctx.ws).find(x => x.name === name)
  if (!s) throw missing('no scenario ' + name + '. Scenarios: ' + (scenarioList(files(ctx), ctx.ws).map(x => x.name).join(', ') || 'none'))
  if (s.error) throw invalid(s.path + ': ' + s.error)
  return s.spec
}
const runOpts = ctx => ({ ws: ctx.ws, who: ctx.who, thread: ctx.thread, signal: ctx.signal, read: path => ctx.tx.read(path) })

export const TESTS = {
  'fixtures.list': {
    sig: '', doc: '[{name, description, parts, error}]',
    run: ctx => fixtureList(files(ctx), ctx.ws).map(f => ({ name: f.name, description: f.description || undefined, parts: f.parts, error: f.error || undefined }))
  },
  'fixtures.save': {
    sig: 'name, {description, docs, tables}', writes: 'files', pathOf: ([name]) => fixturePath(fileName(name)),
    run: (ctx, name, spec) => {
      const bad = checkFixture(spec)
      if (bad) throw invalid(bad)
      const path = fixturePath(fileName(name))
      save(ctx, path, spec)
      return { path }
    }
  },
  // the dev instance's rows as a fixture: tables by name, docs by collection
  'fixtures.capture': {
    sig: 'name, {tables, docs, description}', ret: '{path, tables: [names], docs: [collections]}', doc: 'saves rows of the dev instance as a fixture: tables is a list of table names (["orders"]), docs a list of collections; all their rows go in', writes: 'files', pathOf: ([name]) => fixturePath(fileName(name)),
    run: async (ctx, name, o) => {
      const app = ctx.project.app, spec = { description: o.description || 'captured from the dev instance', docs: {}, tables: {} }
      // a list of names; an object ({orders: …}) gives its keys (agents passed one twice)
      const names = v => Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v) : v ? [v] : []
      o = { ...(o || {}), tables: names((o || {}).tables), docs: names((o || {}).docs) }
      for (const t of o.tables) {
        if (!/^\w+$/.test(t)) throw invalid('table names are words: ' + t)
        spec.tables[t] = await Slop.call('sql', { app, kind: 'dev', query: 'SELECT * FROM "' + t + '"', args: [] })
      }
      for (const c of o.docs) {
        // a document {path: "coll/id", body}: a row with its id
        spec.docs[c] = (await Slop.call('docs', { app, kind: 'dev', coll: c })).map(d => ({ id: d.path.split('/').pop(), ...d.body }))
      }
      const path = fixturePath(fileName(name))
      save(ctx, path, spec)
      return { path, tables: Object.keys(spec.tables), docs: Object.keys(spec.docs) }
    }
  },
  'fixtures.apply': {
    sig: 'name?', doc: 'resets the test instance and seeds it with a fixture (none: empty); canvas frames of the test instance reload', long: true,
    run: (ctx, name) => Fixtures.apply(ctx.project, name || null, ctx.ws, path => ctx.tx.read(path))
  },
  'scenarios.list': {
    sig: '', doc: '[{name, description, page, steps, fixture, error, last}]',
    run: ctx => scenarioList(files(ctx), ctx.ws).map(s => ({
      name: s.name, description: s.spec && s.spec.description || undefined, page: s.spec && s.spec.page, steps: s.spec && Array.isArray(s.spec.steps) ? s.spec.steps.length : 0,
      fixture: s.spec && s.spec.fixture || undefined, error: s.error || undefined, last: s.last ? (s.last.stale ? 'edited since its last run (not run since)' : s.last.ok ? 'passed' : 'failed at step ' + (s.last.failedAt + 1)) : undefined
    }))
  },
  'scenarios.read': { sig: 'name', ret: 'the spec {description, page, size?, fixture?, steps}', run: (ctx, name) => read(ctx, name) },
  'scenarios.save': {
    sig: 'name, spec', writes: 'files', pathOf: ([name]) => SCEN_DIR + fileName(name) + '.json',
    run: (ctx, name, spec) => {
      const bad = checkScenario(spec)
      if (bad) throw invalid(bad)
      const path = SCEN_DIR + fileName(name) + '.json'
      save(ctx, path, spec)
      return { path, steps: spec.steps.length }
    }
  },
  'scenarios.run': {
    sig: 'nameOrSpec', ret: '{name, workspace, ok, ms, failedAt, steps: ["✓ …", "✗ …: why"], snapshots}', doc: 'runs it on the scenarios and code of this eval\'s workspace (a proposal\'s, when you write to one)', long: true,
    run: async (ctx, target) => {
      const name = typeof target === 'string' ? target : 'unsaved', spec = typeof target === 'string' ? read(ctx, target) : target
      const r = await runScenario(ctx.project, spec, { ...runOpts(ctx), name })
      return {
        name, workspace: ctx.ws, ok: r.ok, ms: r.ms, failedAt: r.ok ? undefined : r.failedAt + 1, snapshots: r.snaps.map(s => s.id),
        steps: r.steps.map(s => (s.ok ? '✓ ' : '✗ ') + s.label + (s.error ? ': ' + s.error : '') + (s.errors ? ' [console: ' + s.errors.join('; ') + ']' : ''))
      }
    }
  },
  'scenarios.runAll': {
    // which copy of the app ran: a proposal's results differed from the person's Run all on draft, and
    // nothing said why (round 5: "the agent's results contradict what I saw")
    sig: '', ret: '{workspace, passed, failed, results}', doc: 'every saved scenario of this eval\'s workspace; the person\'s Run all runs the workspace they view, so say which one yours ran on', long: true,
    run: async ctx => {
      const rs = await runAllScenarios(ctx.project, { ...runOpts(ctx), files: files(ctx) })
      return { workspace: ctx.ws, passed: rs.filter(r => r.ok).length, failed: rs.filter(r => !r.ok).length, results: rs.map(r => (r.ok ? '✓ ' : '✗ ') + r.name + (r.error ? ' (step ' + ((r.failedAt ?? -1) + 1) + '): ' + r.error : '')) }
    }
  },
}
