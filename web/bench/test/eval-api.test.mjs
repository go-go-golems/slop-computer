// The transaction side of the host API (agent/api/files.js, lib.js, tx.js)
// on a real Draft over an in-memory actor: dry runs, atomic steps, the
// tests-mode rules, saved functions, files kept by hash.
// node --test test/eval-api.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Draft } from '../src/core/draft.js'
import { defineAPI } from '../src/core/api.js'
import { FILES } from '../src/agent/api/files.js'
import { LIB, libEntries } from '../src/agent/api/lib.js'
import { TX } from '../src/agent/api/tx.js'
import { fakeActor, sha } from './fake-actor.mjs'

const api = defineAPI(FILES, LIB, TX, { 'app.seed': { sig: '{docs, tables}', writes: 'dev', run: () => 'seeded' } })
async function setup(mode = 'auto') {
  const srv = fakeActor({ 'index.html': '<p>hi</p>\n', 'logo.png': 'PNG-BYTES', 'scenarios/a.json': '{}' })
  const d = new Draft({ app: 'x', call: srv.call, hash: async t => sha(t) })
  await d.open()
  const ctx = { mode, who: 'agent', tx: d.begin({ label: 'eval' }), stack: [], changesets: new Map(), logs: [] }
  return { srv, d, ctx, call: (name, ...args) => api.call(ctx, name, args) }
}

test('a dry run captures writes; apply copies them into the eval', async () => {
  const { srv, ctx, call } = await setup()
  await call('dry.begin')
  await call('files.write', 'index.html', '<p>bye</p>\n')
  assert.equal(await call('files.read', 'index.html'), '<p>bye</p>\n')
  await assert.rejects(call('app.seed', {}), err => err.kind === 'policy' && /dry run/.test(err.message))
  await assert.rejects(call('dry.begin'), /already open/)
  const cs = await call('dry.end')
  assert.deepEqual(cs.files, [{ path: 'index.html', change: 'edit', add: 1, del: 1 }])
  assert.match(cs.diff, /^\+<p>bye<\/p>$/m)
  assert.equal(ctx.tx.read('index.html'), '<p>hi</p>\n', 'the eval does not see a dry run')
  assert.equal(await call('app.seed', {}), 'seeded', 'outside the dry run, other writes are allowed')
  assert.deepEqual(await call('dry.apply', cs.id), { applied: 1 })
  const r = await ctx.tx.commit()
  assert.equal(r.status, 'committed')
  assert.deepEqual(srv.commits[0].changes, [{ path: 'index.html', text: '<p>bye</p>\n' }])
})

test('atomic steps: rollback drops their writes, commit folds them into the eval', async () => {
  const { ctx, call } = await setup()
  await call('files.write', 'keep.txt', 'k')
  await call('tx.begin')
  await call('files.write', 'a.txt', 'a')
  assert.deepEqual(await call('tx.rollback'), ['a.txt'])
  assert.equal(ctx.tx.has('a.txt'), false)
  await call('tx.begin')
  await call('files.write', 'b.txt', 'b')
  assert.equal(await call('tx.commit'), true)
  assert.deepEqual(ctx.tx.paths(), ['b.txt', 'keep.txt'])
  assert.equal(ctx.stack.length, 0)
})

test('a tests thread writes scenarios and fixtures, also through a changeset', async () => {
  const { ctx, call } = await setup('tests')
  await assert.rejects(call('files.write', 'index.html', 'x'), err => err.kind === 'policy')
  await assert.rejects(call('lib.def', 'helper', '() => 1', {}, []), err => err.kind === 'policy')
  await call('files.write', 'scenarios/b.json', '{"steps":[]}')
  ctx.mode = 'auto'
  await call('dry.begin')
  await call('files.write', 'index.html', 'x')
  await call('files.write', 'fixtures/f.json', '{}')
  const cs = await call('dry.end')
  ctx.mode = 'tests'
  await assert.rejects(call('dry.apply', cs.id), err => err.kind === 'policy' && /index\.html/.test(err.message))
  assert.deepEqual(await call('dry.apply', cs.id, ['fixtures/f.json']), { applied: 1 })
})

test('saved functions are files the eval reads back', async () => {
  const { ctx, call } = await setup()
  const r = await call('lib.def', 'total', '(xs) => xs.reduce((a, b) => a + b, 0)', { description: 'sums' }, ['xs'])
  assert.deepEqual(r, { saved: 'lib.total', path: '.agent/lib/total.js', params: ['xs'], replaced: false })
  const [l] = libEntries(ctx.tx)
  assert.equal(l.source, '(xs) => xs.reduce((a, b) => a + b, 0)')
  assert.equal(l.description, 'sums')
  assert.equal(await call('lib.source', 'total'), ctx.tx.read('.agent/lib/total.js'))
})

test('files kept by hash: listed, copied and removed, not read', async () => {
  const { srv, ctx, call } = await setup()
  const ls = await call('files.list')
  assert.deepEqual(ls.find(f => f.path === 'logo.png'), { path: 'logo.png', size: 9, lines: null })
  await assert.rejects(call('files.read', 'logo.png'), err => err.kind === 'binary')
  await assert.rejects(call('files.read', 'logo.pn'), err => err.kind === 'missing')
  await call('files.copy', 'logo.png', 'img/logo.png')
  await call('files.remove', 'logo.png')
  await assert.rejects(call('files.write', '../up.txt', 'x'), err => err.kind === 'invalid')
  await ctx.tx.commit()
  assert.deepEqual(srv.commits[0].changes, [{ path: 'img/logo.png', sha256: sha('PNG-BYTES'), size: 9 }, { path: 'logo.png', delete: true }])
  assert.equal(srv.snaps[2].get('img/logo.png'), 'PNG-BYTES')
})
