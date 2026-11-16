// The host API table (src/core/api.js): checks and guards come from the
// declarations. node --test test/api.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defineAPI, parseSig, checkArgs } from '../src/core/api.js'

const api = defineAPI({
  'files.read': { sig: 'path', doc: 'a file', run: (ctx, p) => 'text of ' + p },
  'files.write': { sig: 'path, text', writes: 'files', run: (ctx, p, t) => ({ p, t }) },
  'fixtures.save': { sig: 'name, spec', writes: 'files', pathOf: ([n]) => 'fixtures/' + n + '.json', run: () => true },
  'app.seed': { sig: '{docs, tables}', writes: 'dev', run: () => 'seeded' },
  'publish.run': { sig: '{note}?', writes: 'main', long: true, run: () => 'published' },
  'fixtures.apply': { sig: 'name?', run: () => 'applied' },
  'tx.begin': { sig: '', internal: true, run: () => 1 },
  'frames.move': { sig: 'frameId, x, y', run: () => 'moved' },
  'agents.delegate': { sig: 'role, task, {output, evals}?', long: true, run: () => 'ok' },
  'log': { sig: '...values', run: (ctx, ...v) => v.length },
})

test('signatures: required, optional, braces, rest', () => {
  assert.deepEqual(parseSig('route, {w, h}?, ...rest').map(p => [p.name, p.optional, p.rest]), [['route', false, false], ['{w, h}', true, false], ['rest', true, true]])
  assert.equal(checkArgs('x', 'a, b?', ['1']), null)
  assert.match(checkArgs('x', 'a, b', ['1']), /x needs a, b \(missing b\) · usage: x\(a, b\)/)
})

test('every declared call with a missing argument fails with its usage', async () => {
  for (const name of api.names()) {
    const e = api.entries.get(name), required = parseSig(e.sig).filter(p => !p.optional)
    if (!required.length) continue
    await assert.rejects(api.call({}, name, []), err => err.kind === 'invalid' && err.message.includes('usage: ' + name + '('))
  }
})

test('a read-only thread writes nothing', async () => {
  const ctx = { mode: 'read' }
  for (const name of api.names()) {
    const e = api.entries.get(name)
    const args = parseSig(e.sig).map(() => 'x')
    if (e.writes) await assert.rejects(api.call(ctx, name, args), err => err.kind === 'policy')
    else await api.call(ctx, name, args)
  }
})

test('a tests thread writes scenarios and fixtures only', async () => {
  const ctx = { mode: 'tests' }
  await assert.rejects(api.call(ctx, 'files.write', ['index.html', '']), err => err.kind === 'policy')
  assert.deepEqual(await api.call(ctx, 'files.write', ['scenarios/a.json', '{}']), { p: 'scenarios/a.json', t: '{}' })
  assert.equal(await api.call(ctx, 'fixtures.save', ['empty', {}]), true)
  await assert.rejects(api.call(ctx, 'app.seed', [{}]), err => err.kind === 'policy')
  await assert.rejects(api.call(ctx, 'publish.run', []), err => err.kind === 'policy')
  assert.equal(await api.call(ctx, 'fixtures.apply', []), 'applied')
})

test('a dry run refuses every write but files', async () => {
  for (const name of api.names()) {
    const e = api.entries.get(name), args = parseSig(e.sig).map(() => 'x')
    if (e.writes && e.writes !== 'files') await assert.rejects(api.call({ mode: 'auto', tx: { dry: true } }, name, args), /dry run/)
    else await api.call({ mode: 'auto', tx: { dry: true } }, name, args)
  }
  assert.equal(await api.call({ mode: 'auto', tx: { dry: false } }, 'app.seed', [{}]), 'seeded')
})

test('unknown calls, long calls, the reference, duplicates', async () => {
  await assert.rejects(api.call({}, 'files.nope', []), err => err.kind === 'unknown')
  assert.deepEqual(api.long(), ['publish.run', 'agents.delegate'])
  const ref = api.reference({ files: 'paths are relative' })
  assert.match(ref, /^files\.read\(path\) — a file$/m)
  assert.match(ref, /^files\.write\(path, text\)\n  paths are relative$/m)
  assert.doesNotMatch(ref, /tx\.begin/)
  assert.equal(await api.call({}, 'log', [1, 2, 3]), 3)
  assert.throws(() => api.add({ 'files.read': { run: () => 1 } }), /declared twice/)
  assert.throws(() => defineAPI({ 'x.y': { writes: 'everything', run: () => 1 } }), /writes is one of/)
})
