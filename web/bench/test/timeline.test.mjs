// The timeline's questions (src/model/timeline.js) on a real Draft over the
// stand-in actor: restoring to an event, diffs since one, versions and blame,
// when the timeline begins after the app did.
// node --test test/timeline.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Draft } from '../src/core/draft.js'
import { blame, restore, since, stampEvent, versions } from '../src/model/timeline.js'
import { fakeActor, sha } from './fake-actor.mjs'

// An app opened in the bench for the first time: three files at snapshot 1,
// and an empty timeline. log() stamps events as model/project.js does.
async function opened() {
  const srv = fakeActor({ 'index.html': '<h1>Hi</h1>\n', 'styles.css': 'body {}\n', 'logo.png': 'PNG' })
  const d = new Draft({ app: 'x', call: srv.call, hash: async t => sha(t) })
  await d.open()
  const events = []
  const P = {
    app: 'x', events, threads: new Map(),
    draftOf: () => d, view: () => d.edits || d,
    event: seq => events.find(e => e.seq === seq) || null,
    log(e) { const ev = { ...stampEvent(e, () => d.head), seq: events.length + 1, at: Date.now(), who: e.who || 'you' }; events.push(ev); return ev },
  }
  const commit = async (label, fn) => {
    const tx = d.begin(); fn(tx)
    const r = await tx.commit()
    assert.equal(r.status, 'committed')
    P.log({ kind: 'commit', ref: 'draft', n: r.n, paths: r.paths, note: label })
    return r
  }
  return { srv, d, P, commit }
}
const files = d => Object.fromEntries(d.list().map(p => [p, d.read(p) ?? 'hash:' + d.entry(p).sha256]))

test('a bookmark made before any commit records the snapshot it saw', async () => {
  const { d, P } = await opened()
  const m = P.log({ kind: 'mark', label: 'before anything' })
  assert.equal(m.ref, 'draft')
  assert.equal(m.n, d.head)
})

test('restoring to that bookmark puts the app back, it does not delete it', async () => {
  const { d, P, commit } = await opened()
  const before = files(d)
  const m = P.log({ kind: 'mark', label: 'before anything' })
  await commit('edit', tx => { tx.write('index.html', '<h1>Changed</h1>\n'); tx.write('new.txt', 'new\n'); tx.remove('styles.css') })
  assert.deepEqual((await since(P, m.seq)).map(c => c.path), ['index.html', 'new.txt', 'styles.css'])
  const r = await restore(P, m.seq)
  assert.equal(r.status, 'committed')
  assert.deepEqual(files(d), before)
})

test('a state the timeline never recorded is refused, not taken for the empty tree', async () => {
  const { d, P } = await opened()
  // an event from before events recorded snapshots: nothing on draft is known
  P.events.push({ seq: 1, kind: 'msg', ref: 'draft', n: null, at: Date.now(), who: 'you' })
  const head = d.head
  await assert.rejects(restore(P, 1), err => err.kind === 'missing')
  await assert.rejects(since(P, 1), err => err.kind === 'missing')
  assert.equal(d.head, head, 'nothing was committed')
  assert.equal(d.list().length, 3)
})

test('versions: the first state seen is observed; blame gives its lines to no one', async () => {
  const { P, commit } = await opened()
  P.log({ kind: 'mark', label: 'start' })
  const c = await commit('add a line', tx => tx.write('index.html', '<h1>Hi</h1>\n<p>more</p>\n'))
  const vs = await versions(P, 'index.html')
  assert.deepEqual(vs.map(v => [v.kind, v.observed]), [['mark', true], ['commit', false]])
  assert.equal(vs[1].n, c.n)
  const commitSeq = P.events.find(e => e.kind === 'commit').seq
  // three lines: the heading, the new paragraph, the empty one after the last newline
  assert.deepEqual(await blame(P, 'index.html'), [undefined, commitSeq, undefined])
})
