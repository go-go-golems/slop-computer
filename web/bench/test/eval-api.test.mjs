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

// "not a function (line N)" names the line and the calls on it the API
// lacks (an agent retried app.sql five times without knowing).
test('notAFunctionHint names the unknown call', async () => {
  const { notAFunctionHint } = await import('../src/agent/hints.js')
  const fake = { names: () => ['app.status', 'app.info', 'sql.query', 'files.read', 'frames.text'] }
  const code = 'const st = await app.status()\nconst rows = await app.sql("SELECT 1")\nreturn rows'
  const h = notAFunctionHint({ message: 'not a function', line: 2 }, code, fake)
  assert.match(h, /the line: `const rows = await app\.sql\("SELECT 1"\)`/)
  assert.match(h, /app\.sql is not in the API \(did you mean .*app\.status/)
  assert.equal(notAFunctionHint({ message: 'boom', line: 2 }, code, fake), '')
  assert.equal(notAFunctionHint({ message: 'not a function', line: 1 }, code, fake), ' — the line: `const st = await app.status()`')
})

// The session's declarations are rewritten into assignments; a destructuring
// one is wrapped in parentheses, which continued the line before it when
// that line had no semicolon: "TypeError: not a function (line 2)" for
// const mt = await files.read('main.ts') / const [ih, css] = await … (a
// persona review's agent failed five evals on it).
test('rewrite: a destructuring declaration after a line without a semicolon', async () => {
  const { rewrite } = await import('../src/worker/rewrite.js')
  const code = "const mt = await read('main.ts')\nconst [ih, css] = await Promise.all([read('a'), read('b')])\nclass C {}\nreturn mt + ih + css"
  const rw = rewrite(code, new Set(['read']))
  assert.deepEqual(rw.names.sort(), ['C', 'css', 'ih', 'mt'])
  assert.equal(rw.code.split('\n').length, code.split('\n').length, 'lines keep their numbers')
  // the session's names are variables the rewritten code assigns
  const fn = new Function('read', 'let ' + rw.names.join(', ') + '; return (async () => {\n' + rw.code + '\n})()')
  assert.equal(await fn(async p => p.toUpperCase()), 'MAIN.TSAB')
})

test('rewrite: a top-level declaration of an API name is reported', async () => {
  const { rewrite } = await import('../src/worker/rewrite.js')
  const reserved = new Set(['files', 'app', 'frames'])
  assert.deepEqual(rewrite('const [info, app] = await par([app.info()])', reserved).shadows, ['app'])
  assert.deepEqual(rewrite('const frames = await frames.list()\nfunction files() {}', reserved).shadows, ['frames', 'files'])
  assert.deepEqual(rewrite('const fileList = await files.list()\nconst f = x => { const files = 1; return files }', reserved).shadows, [], 'a nested name is fine')
  const ns = Object.assign(new Set(['files', 'app', 's', 'id']), { ns: new Set(['files', 'app']) })
  const loc = rewrite('const s = await app.status()\nreturn s.ok', ns)
  assert.deepEqual(loc.shadows, [], 'a flat name used after its declaration is a local')
  assert.ok(!loc.names.includes('s') && /const s = /.test(loc.code), 'kept as a local const: ' + loc.code)
  assert.deepEqual(rewrite('const [a, id] = await par([id(1)])', ns).shadows, ['id'], 'used in its own declaration: refused')
  assert.deepEqual(rewrite('const files = 1', ns).shadows, ['files'], 'a namespace: refused')
})

test('lib.def analysis: free names and parameters of a saved function', async () => {
  // these lived in worker.js beside a collectPattern that moved out with rewrite: lib.def failed
  // "collectPattern is not defined" in every eval that saved a function (round 3)
  const acorn = await import('acorn')
  const { freeNames, paramsOf } = await import('../src/worker/rewrite.js')
  const fn = acorn.parse('(async ({ rows, week = 1 }, [first], ...rest) => { const { a, b: [c] } = rows; try { x() } catch ({ message }) { return message } return WEEK_START + a + c + first + rest.length })', { ecmaVersion: 'latest' }).body[0].expression
  const free = freeNames(fn)
  assert.ok(free.includes('WEEK_START') && free.includes('x'), 'outer names are free: ' + free)
  for (const n of ['rows', 'week', 'first', 'rest', 'a', 'c', 'message']) assert.ok(!free.includes(n), n + ' is declared')
  assert.equal(paramsOf(fn).length, 3)
})

test('FAKED_EVAL: eval code written as text, not page code or plain words', async () => {
  const { FAKED_EVAL } = await import('../src/agent/hints.js')
  assert.ok(FAKED_EVAL.test("Reading first.\n\n[eval #1\n```\nconst p = await files.read('index.html');\n```\n]\n\nConfirmed."), 'the round-4 reply')
  assert.ok(FAKED_EVAL.test("Now:\n```js\nawait files.replace('main.ts', 'a', 'b')\n```"), 'a fenced API call')
  assert.ok(!FAKED_EVAL.test('I changed index.html: Export CSV now builds the file from rows.'), 'plain words')
  assert.ok(!FAKED_EVAL.test("In your page:\n```js\nconst db = await claude.use('db')\n```"), 'page code')
})

test('fitPrompt: cuts the largest turns, keeps the last, fits the limit', async () => {
  const { fitPrompt } = await import('../src/agent/hints.js')
  const big = 'a'.repeat(200000), small = 'b'.repeat(1000), last = 'c'.repeat(90000)
  const { msgs, cut } = fitPrompt([{ role: 'user', content: big }, { role: 'assistant', content: small }, { role: 'user', content: last }], 240000)
  const total = msgs.reduce((a, m) => a + m.content.length, 0)
  assert.ok(total <= 240000, 'fits: ' + total)
  assert.equal(msgs[2].content, last, 'the current message is kept')
  assert.equal(msgs[1].content, small)
  assert.match(msgs[0].content, /characters cut here/)
  assert.equal(cut.length, 1)
  const same = fitPrompt([{ role: 'user', content: 'hi' }])
  assert.equal(same.cut.length, 0); assert.equal(same.msgs[0].content, 'hi')
  const multi = fitPrompt([{ role: 'user', content: 'é'.repeat(150000) }], 240000) // 2 bytes a character
  assert.ok(new TextEncoder().encode(multi.msgs[0].content).length <= 240000)
})

test('rewrite: declarations without a value, and destructuring, followed by a comma', async () => {
  const { rewrite } = await import('../src/worker/rewrite.js')
  const run = c => { const r = rewrite(c, new Set()); return new Function('let applied, rowsNow, a, b, x, y;' + r.code + '; return [typeof applied, a, b, x, y]')() }
  assert.deepEqual(run('let applied, rowsNow;'), ['undefined', undefined, undefined, undefined, undefined])
  assert.deepEqual(run('let a, b = 2;'), ['undefined', undefined, 2, undefined, undefined])
  assert.deepEqual(run('const [x] = [1], y = 2;'), ['undefined', undefined, undefined, 1, 2])
  assert.deepEqual(run('let a = 1, b;'), ['undefined', 1, undefined, undefined, undefined])
})
