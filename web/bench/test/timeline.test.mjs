// The timeline's questions (src/model/timeline.js) on a real Draft over the
// stand-in actor: restoring to an event, diffs since one, versions and blame,
// when the timeline begins after the app did.
// node --test test/timeline.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Draft } from '../src/core/draft.js'
import { blame, changesSince, restoreTo, snapshotAt, stampEvent, versions } from '../src/model/timeline.js'
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
    log(e) { const ev = { ...stampEvent(e, ref => ref === 'draft' ? d.head : null), seq: events.length + 1, at: Date.now(), who: e.who || 'you' }; events.push(ev); return ev },
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
  const then = snapshotAt(P, m.seq, 'draft')
  assert.equal(then, m.n)
  assert.deepEqual((await changesSince(P, 'draft', then)).map(c => c.path), ['index.html', 'new.txt', 'styles.css'])
  const r = await restoreTo(P, 'draft', then, { label: m.label })
  assert.equal(r.status, 'committed')
  assert.deepEqual(files(d), before)
})

test('an event belongs to one workspace: no snapshot of another, nothing inferred', async () => {
  const { P } = await opened()
  const e = P.log({ kind: 'eval', ref: 'proposal/p1', n: 7 })
  assert.equal(snapshotAt(P, e.seq, 'proposal/p1'), 7)
  assert.equal(snapshotAt(P, e.seq, 'draft'), null)
  assert.equal(snapshotAt(P, 99, 'draft'), null, 'no such event')
})

test('a ref the project does not know cannot be stamped', () => {
  assert.deepEqual(stampEvent({ kind: 'mark' }, ref => ref === 'draft' ? 4 : null), { kind: 'mark', ref: 'draft', n: 4 })
  assert.equal(stampEvent({ kind: 'eval', ref: 'proposal/gone' }, ref => ref === 'draft' ? 4 : null).n, null)
  assert.equal(stampEvent({ kind: 'outside', ref: 'draft', n: 9 }, () => 4).n, 9, 'an event that says which keeps it')
})

test('restore and diff take a snapshot: 0 (no ref, the empty tree) and null (unknown) are not one', async () => {
  const { d, P } = await opened()
  const head = d.head
  for (const bad of [0, null, undefined, -1, 1.5, '2']) {
    await assert.rejects(restoreTo(P, 'draft', bad), err => err.kind === 'invalid')
    await assert.rejects(changesSince(P, 'draft', bad), err => err.kind === 'invalid')
  }
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
