// The type checker (SLOP3-024 phase 3): the built checker.js, run in a vm
// with a stand-in for the worker's self, against the fixture TypeScript app
// pkg/host uses (testdata/tsnotes) and slop's declarations (pkg/apptypes);
// and Types.diff, which turns two checks into an eval's types effect.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import vm from 'node:vm'
import { Types } from '../src/agent/types.js'

const repo = new URL('../../../', import.meta.url).pathname
function checker() {
  const out = []
  const self = { postMessage: m => out.push(m) }
  vm.runInNewContext(readFileSync(join(repo, 'apps/bench/checker.js'), 'utf8'), { self, performance, console, TextEncoder, TextDecoder })
  assert.equal(out.shift().type, 'ready')
  // answers cross from the vm's realm as JSON, as postMessage copies them
  return m => { self.onmessage({ data: m }); return JSON.parse(JSON.stringify(out.pop())) }
}
function app() {
  const root = join(repo, 'pkg/host/testdata/tsnotes'), files = {}
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files[relative(root, p)] = readFileSync(p, 'utf8') } }
  walk(root)
  return files
}
const decl = {
  'page.d.ts': readFileSync(join(repo, 'pkg/apptypes/page.d.ts'), 'utf8'),
  'actor.d.ts': readFileSync(join(repo, 'pkg/apptypes/actor.d.ts'), 'utf8'),
  'modules.d.ts': 'declare module "yaml" { export function stringify(v: unknown): string }\ninterface SlopModules { workshop: any }\n',
  'actions.d.ts': 'interface AppActions {}\n',
}

test('the checker checks the pages and the actor as tsc does', () => {
  const send = checker(), files = app()
  let r = send({ type: 'check', id: 1, files, decl })
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.diags, [])
  files['main.ts'] = files['main.ts'].replace("{ text: 'from the page' }", "{ txt: 'from the page' }")
  files['actor.ts'] = files['actor.ts'].replace('return { id: lastRowid }', 'return { id: String(lastRowid) }')
  r = send({ type: 'check', id: 2, files, decl })
  const got = r.diags.map(d => d.program + ' ' + d.file + ':' + d.line)
  assert.deepEqual(got.sort(), ['actor actor.ts:19', 'pages main.ts:6'])
  assert.match(r.diags.find(d => d.program === 'pages').message, /'txt' does not exist/)
  // a file only the actor uses is not part of the pages
  assert.ok(!r.diags.some(d => d.program === 'pages' && d.file.startsWith('server/')))
})

test('the type under a position, and TypeScript evals', () => {
  const send = checker(), files = app()
  const r = send({ type: 'info', id: 1, files, decl, path: 'main.ts', pos: files['main.ts'].indexOf('slop.actions') + 1 })
  assert.equal(r.text, 'const slop: SlopOf<Actions>')
  const t = send({ type: 'transpile', id: 2, code: "const xs: number[] = [1, 2]\nreturn xs.map((x: number) => x * 2) as number[]" })
  assert.equal(t.ok, true)
  assert.equal(t.code.trim(), 'const xs = [1, 2];\n    return xs.map((x) => x * 2);')
  const bad = send({ type: 'transpile', id: 3, code: 'let x: = 1' })
  assert.equal(bad.ok, false)
  assert.equal(bad.line, 1)
})

test('Types.diff: new errors by file, code and message, not line; fixed counted', () => {
  const e = (file, line, message, code = 2322) => ({ file, line, col: 1, code, message, program: 'pages' })
  const before = { diags: [e('a.ts', 3, 'old'), e('a.ts', 9, 'twice'), e('a.ts', 12, 'twice'), e('b.ts', 1, 'gone')] }
  const after = { diags: [e('a.ts', 5, 'old'), e('a.ts', 9, 'twice'), e('a.ts', 12, 'twice'), e('a.ts', 20, 'twice'), e('c.ts', 2, 'new one')] }
  assert.deepEqual(Types.diff(before, after), { new: [{ file: 'a.ts', line: 20, message: 'twice' }, { file: 'c.ts', line: 2, message: 'new one' }], fixed: 1, total: 5 })
  assert.deepEqual(Types.diff({ skipped: 'loading' }, after), { skipped: 'no check from before the eval (loading)', total: 5 })
  assert.deepEqual(Types.diff(before, { skipped: 'slow' }), { skipped: 'slow' })
})

test('Types.wants: an app with TypeScript of its own', () => {
  const view = paths => ({ list: () => paths, read: () => '' })
  assert.equal(Types.wants(view(['index.html', 'main.js', 'vendor/x/index.d.ts'])), false)
  assert.equal(Types.wants(view(['index.html', 'main.ts'])), true)
  assert.equal(Types.wants(view(['app.json', 'actor.ts'])), true)
})
