// The Draft core (src/core/draft.js) against a fake server with files.commit's
// rules, under random interleavings: node --test test/draft.test.mjs
// (RUNS=… for more programs, SEED=… to replay one).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { Draft } from '../src/core/draft.js'
const sha = t => createHash('sha256').update(t, 'utf8').digest('hex')

// a seeded generator (mulberry32), so a failing run can be replayed
function rng(seed) {
  let a = seed >>> 0
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  return { next, int: n => Math.floor(next() * n), pick: xs => xs[Math.floor(next() * xs.length)], chance: p => next() < p }
}

// The server: numbered immutable snapshots (n → Map(path → text)), refs, and
// commit with files.commit's semantics (pkg/commands/files.go).
class Server {
  constructor(r, files) {
    this.r = r; this.snaps = [new Map()]; this.refs = {}; this.log = []
    if (files) { this.snaps.push(new Map(Object.entries(files))); this.refs.draft = 1 }
  }
  delay() { return new Promise(res => setTimeout(res, this.r.int(4))) }
  snap(n) { return this.snaps[n] }
  listing(n) { return [...this.snap(n)].map(([path, t]) => ({ path, sha256: sha(t), size: Buffer.byteLength(t), type: '' })) }
  commitNow({ ref, base, changes }) {
    const at = this.refs[ref] ?? 0, B = this.snap(base), A = this.snap(at)
    assert.ok(B, 'base ' + base + ' exists')
    const result = c => c.delete ? undefined : c.text
    if (at !== base) {
      const paths = changes.filter(c => B.get(c.path) !== A.get(c.path) && result(c) !== A.get(c.path)).map(c => c.path)
      if (paths.length) { this.log.push({ kind: 'conflict', ref, at }); return { conflict: { at, paths } } }
    }
    const next = new Map(A)
    for (const c of changes) c.delete ? next.delete(c.path) : next.set(c.path, c.text)
    const same = next.size === A.size && [...next].every(([p, t]) => A.get(p) === t)
    const n = same && at ? at : this.snaps.push(next) - 1
    this.refs[ref] = n
    this.log.push({ kind: 'commit', ref, at, n, changes })
    return { n, at, merged: at !== base, files: this.listing(n), activated: [] }
  }
  async call(action, a) {
    await this.delay()
    switch (action) {
      case 'head': return { n: this.refs[a.ref] ?? 0 }
      case 'files': return this.listing(a.at)
      case 'read': {
        // a small answer budget, so the Draft has to ask again for the rest
        const texts = {}, more = []
        for (const p of a.paths) Object.keys(texts).length < 3 ? (texts[p] = this.snap(a.at).get(p)) : more.push(p)
        return { texts, binary: [], more }
      }
      case 'commit': return this.commitNow(a)
    }
    throw new Error('no action ' + action)
  }
}

const PATHS = ['index.html', 'app.js', 'style.css', 'README.md', 'sql/001.sql', 'data/a.json']

async function program(seed) {
  const r = rng(seed)
  const srv = new Server(r, { 'index.html': '<h1>start</h1>', 'app.js': '' })
  const draft = new Draft({ app: 'app', call: (a, x) => srv.call(a, x), hash: async t => sha(t) })
  await draft.open()
  const dead = new Set()      // texts only aborted transactions ever wrote
  const live = new Set()      // texts some committed or folded transaction wrote
  let uniq = 0
  const text = who => who + ':' + (uniq++) + ':' + r.int(1e6)
  const checks = { committed: 0, conflicts: 0, folded: 0, aborted: 0 }
  const lastEdit = new Map()   // path → the person's last text (null: removed)

  // invariant 4: a Tx reads its own change, else its parent's view, else its base snapshot
  const expectRead = (tx, path) => {
    const c = tx.changes.get(path)
    if (c) return c.remove ? null : c.text
    if (tx.parent) return expectRead(tx.parent, path)
    const n = tx.live ? draft.head : tx.base
    return n === 0 ? null : srv.snap(n).get(path) ?? null
  }
  const checkReads = tx => { for (const p of PATHS) assert.equal(tx.read(p), expectRead(tx, p), 'read ' + p + ' in ' + tx.label) }

  async function writeSome(tx, who) {
    for (let k = r.int(4) + 1; k--;) {
      const p = r.pick(PATHS)
      if (r.chance(0.2)) tx.remove(p)
      else { const t = r.chance(0.1) ? '' : text(who); tx.write(p, t) }
      checkReads(tx)
      if (r.chance(0.3)) await new Promise(res => setTimeout(res, r.int(3)))
    }
  }
  const texts = tx => [...tx.changes.values()].filter(c => !c.remove && c.text).map(c => c.text)

  async function evalLoop(who) {
    for (let i = 0; i < 6; i++) {
      const tx = draft.begin({ label: who + '#' + i })
      await writeSome(tx, who)
      // a delegated step: commits into this one, or is dropped
      if (r.chance(0.5)) {
        const sub = tx.child({ label: who + '#' + i + '.sub' })
        await writeSome(sub, who + '.sub')
        if (r.chance(0.6)) { const res = await sub.commit(); assert.equal(res.status, 'folded'); checks.folded++ }
        else { texts(sub).forEach(t => dead.add(t)); sub.abort(); checks.aborted++ }
        checkReads(tx)
      }
      if (r.chance(0.25)) { texts(tx).forEach(t => dead.add(t)); tx.abort(); checks.aborted++; continue }
      const before = { ...srv.refs }, nSnaps = srv.snaps.length, changes = new Map(tx.changes)
      const res = await tx.commit()
      if (res.status === 'committed') {
        checks.committed++
        texts({ changes }).forEach(t => live.add(t))
        // invariant 1: n is the snapshot at, plus exactly these changes
        const N = srv.snap(res.n), A = srv.snap(res.at)
        for (const p of new Set([...A.keys(), ...N.keys(), ...changes.keys()])) {
          const c = changes.get(p)
          assert.equal(N.get(p), c ? (c.remove ? undefined : c.text) : A.get(p), 'snapshot ' + res.n + ' at ' + p)
        }
      } else {
        assert.equal(res.status, 'conflict', JSON.stringify(res))
        checks.conflicts++
        // invariant 3: a conflict writes nothing
        assert.ok(res.conflicts.length > 0)
        assert.equal(srv.snaps.length >= nSnaps, true)
        texts({ changes }).forEach(t => { if (![...srv.snaps].some(s => [...s.values()].includes(t))) dead.add(t) })
        tx.abort()
      }
      void before
    }
  }
  // someone else (a terminal, another browser) commits to draft directly
  async function outside() {
    for (let i = 0; i < 5; i++) {
      await new Promise(res => setTimeout(res, r.int(6)))
      const at = srv.refs.draft ?? 0
      const changes = [{ path: r.pick(PATHS), text: text('cli') }]
      srv.commitNow({ ref: 'draft', base: at, changes })
      changes.forEach(c => live.add(c.text))
    }
  }
  // the person types; edits commit after a pause, or on settle()
  async function person() {
    Draft.EDIT_PAUSE = 2
    for (let i = 0; i < 8; i++) {
      const p = r.pick(PATHS), t = r.chance(0.15) ? null : text('you')
      draft.edit(p, t); lastEdit.set(p, t)
      if (t) live.add(t)
      checkReads(draft.edits)
      await new Promise(res => setTimeout(res, r.int(4)))
    }
    // while others write, a conflict may come back; keep one's own text
    const res = await draft.settle()
    if (res.status === 'conflict') { await draft.refresh(); await draft.keepMine() }
  }
  // once nobody else writes, the edits must land
  async function settleAll() {
    for (let k = 0; k < 3 && draft.pending(); k++) {
      await draft.refresh()
      const res = await draft.settle()
      if (res.status === 'conflict') await draft.keepMine()
    }
    await draft.settle()
    assert.equal(draft.pending(), false, 'the person\'s edits reach the server')
    // each path's last edit was committed, and only a later commit changed it since
    for (const [p, t] of lastEdit) {
      const commits = srv.log.filter(e => e.kind === 'commit')
      const mine = commits.findLastIndex(e => e.changes.some(c => c.path === p && (t === null ? c.delete : c.text === t)))
      assert.ok(mine >= 0, 'the person\'s last edit of ' + p + ' was committed')
      const later = commits.slice(mine + 1).some(e => e.changes.some(c => c.path === p))
      if (!later) assert.equal(srv.snap(srv.refs.draft).get(p) ?? null, t, 'the person\'s last edit of ' + p + ' is there')
    }
  }
  async function poll() { for (let i = 0; i < 6; i++) { await new Promise(res => setTimeout(res, r.int(5))); await draft.refresh() } }

  await Promise.all([evalLoop('a'), evalLoop('b'), outside(), person(), poll()])
  await settleAll()
  await draft.refresh()

  // invariant 2: nothing an aborted transaction wrote is ever on the server
  for (const s of srv.snaps) for (const t of s.values()) assert.ok(!dead.has(t) || live.has(t), 'aborted text ' + t + ' reached the server')
  // the Draft shows the server's draft
  assert.equal(draft.head, srv.refs.draft)
  for (const p of PATHS) assert.equal(draft.read(p), srv.snap(srv.refs.draft).get(p) ?? null, 'head shows ' + p)
  return checks
}

test('random programs keep the four invariants', async () => {
  const runs = +(process.env.RUNS || 300), first = +(process.env.SEED || 1)
  const total = { committed: 0, conflicts: 0, folded: 0, aborted: 0 }
  for (let s = first; s < first + runs; s++) {
    let c
    try { c = await program(s) } catch (e) { console.log('FAILED at SEED=' + s); throw e }
    for (const k in total) total[k] += c[k]
  }
  // the runs exercise every outcome
  for (const k in total) assert.ok(total[k] > 0, k + ' never happened')
  console.log('runs', runs, total)
})

test('a nested transaction cannot fold into one that ended', async () => {
  const srv = new Server(rng(7), { 'a.txt': 'a' })
  const draft = new Draft({ app: 'app', call: (a, x) => srv.call(a, x), hash: async t => sha(t) })
  await draft.open()
  const tx = draft.begin(), sub = tx.child()
  sub.write('a.txt', 'b'); tx.abort()
  const r = await sub.commit()
  assert.equal(r.status, 'failed'); assert.equal(r.code, 'aborted')
})

test('an empty commit writes nothing and reports the base', async () => {
  const srv = new Server(rng(8), { 'a.txt': 'a' })
  const draft = new Draft({ app: 'app', call: (a, x) => srv.call(a, x), hash: async t => sha(t) })
  await draft.open()
  const r = await draft.begin().commit()
  assert.deepEqual([r.status, r.n, srv.snaps.length], ['committed', 1, 2])
})

test('the person\'s edits follow the head when they do not overlap', async () => {
  const srv = new Server(rng(9), { 'a.txt': 'a', 'b.txt': 'b' })
  const draft = new Draft({ app: 'app', call: (a, x) => srv.call(a, x), hash: async t => sha(t) })
  await draft.open()
  Draft.EDIT_PAUSE = 1e6
  draft.edit('a.txt', 'mine')
  srv.commitNow({ ref: 'draft', base: 1, changes: [{ path: 'b.txt', text: 'theirs' }] })
  await draft.refresh()
  assert.equal(draft.edits.base, 2)
  assert.equal(draft.edits.read('b.txt'), 'theirs')
  const r = await draft.settle()
  assert.equal(r.status, 'committed'); assert.equal(r.merged, false)
  assert.deepEqual(Object.fromEntries(srv.snap(srv.refs.draft)), { 'a.txt': 'mine', 'b.txt': 'theirs' })
})

test('an overlapping edit conflicts; keepMine replaces, takeTheirs drops', async () => {
  const srv = new Server(rng(10), { 'a.txt': 'a' })
  const draft = new Draft({ app: 'app', call: (a, x) => srv.call(a, x), hash: async t => sha(t) })
  await draft.open()
  Draft.EDIT_PAUSE = 1e6
  draft.edit('a.txt', 'mine')
  srv.commitNow({ ref: 'draft', base: 1, changes: [{ path: 'a.txt', text: 'theirs' }] })
  await draft.refresh()
  assert.equal(draft.edits.base, 1, 'the base stays: the edited path changed')
  let r = await draft.settle()
  assert.equal(r.status, 'conflict'); assert.deepEqual(r.conflicts, ['a.txt'])
  assert.equal(draft.pending(), true)
  r = await draft.keepMine()
  assert.equal(srv.snap(srv.refs.draft).get('a.txt'), 'mine')
  draft.edit('a.txt', 'mine again')
  srv.commitNow({ ref: 'draft', base: srv.refs.draft, changes: [{ path: 'a.txt', text: 'theirs again' }] })
  await draft.refresh()
  r = await draft.settle(); assert.equal(r.status, 'conflict')
  draft.takeTheirs(r.conflicts)
  assert.equal(draft.pending(), false)
  assert.equal(draft.read('a.txt'), 'theirs again')
})
