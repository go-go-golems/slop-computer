// Pinboard core, with an in-memory storage adapter: node --test apps/pinboard/test/core.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');

function board(level = 'interact') {
  const S = { clips: {}, apps: {}, collections: {}, records: {} };
  const st = { level };
  const core = C.createCore({
    get: (s, i) => S[s][i],
    put: (s, i, v) => { if (v == null) delete S[s][i]; else S[s][i] = v; },
    list: (s) => Object.values(S[s]),
    level: () => st.level,
  });
  return { S, core, st };
}

test('equality ignores key order', () => {
  assert.ok(C.same({ a: 1, b: { c: [1, { x: 1, y: 2 }] } }, { b: { c: [1, { y: 2, x: 1 }] }, a: 1 }));
  assert.ok(!C.same({ a: 1 }, { a: 2 }));
  assert.ok(C.same(undefined, null));
});

test('path segments round-trip free text', () => {
  for (const s of ['recipes', 'my recipes!', 'a/b', 'ä~ü', 'x:y@z+1']) {
    assert.match(C.seg(s), /^[A-Za-z0-9_\-.:@+~]+$/);
    assert.strictEqual(C.unseg(C.seg(s)), s);
  }
  assert.deepStrictEqual(C.parsePath('colls/' + C.seg('my recipes')), { store: 'collections', id: 'my recipes' });
});

test('ids have a kind and ten base-36 characters', () => {
  assert.match(C.newId('clip'), /^clip:[0-9a-z]{10}$/);
});

test('a transaction records before and after, and keys', () => {
  const { S, core } = board();
  const r = core.mutate(m => { const id = m.place({ kind: 'note', text: 'x' }); m.tag(id, 'a'); return id; });
  assert.strictEqual(r.ops.length, 2);
  assert.strictEqual(r.ops[0].before, null);
  assert.deepStrictEqual(S.clips[r.result].tags, ['a']);
  assert.ok(r.keys.has('clips:' + r.result));
});

test('a failing transaction leaves the board as it was', () => {
  const { S, core } = board();
  assert.throws(() => core.mutate(m => { m.place({ kind: 'note' }); m.move('clip:missing', { x: 1, y: 1 }); }), /no clip/);
  assert.strictEqual(Object.keys(S.clips).length, 0);
});

test('revert puts back only what still holds the written value', () => {
  const { S, core } = board();
  const r = core.mutate(m => [m.place({ kind: 'note', text: 'a' }), m.place({ kind: 'note', text: 'b' })]);
  const [a, b] = r.result;
  S.clips[b] = Object.assign({}, S.clips[b], { x: 99 });          // someone else moved b
  const rv = core.revert(r.ops);
  assert.strictEqual(rv.applied.length, 1);
  assert.strictEqual(rv.conflicts.length, 1);
  assert.ok(!S.clips[a] && S.clips[b]);
  // the caller may allow overwriting (undo of my own change, nobody else touched it)
  const r2 = core.mutate(m => m.place({ kind: 'note' }));
  S.clips[r2.result].text = 'typed by me, quietly';
  assert.strictEqual(core.revert(r2.ops, () => true).applied.length, 1);
});

test('levels: viewers cannot write, only admins register apps', () => {
  const { core, st } = board('view');
  assert.throws(() => core.mutate(m => m.place({ kind: 'note' })), /read-only/);
  st.level = 'interact';
  assert.throws(() => core.mutate(m => m.register({ name: 'x', source: '' })), /admins/);
  st.level = 'admin';
  core.mutate(m => m.register({ name: 'x', source: '' }));
});

test('collections, records, query and describe', () => {
  const { S, core } = board();
  core.mutate(m => { m.insert('recipes', { title: 'Soup', minutes: 20 }); m.insert('recipes', { title: 'Cake', minutes: 60 }); m.insert('books', { title: 'Dune' }); });
  const rows = C.query(S, 'recipes', { where: [['minutes', '<', 30]] });
  assert.deepStrictEqual(rows.map(r => r.title), ['Soup']);
  assert.deepStrictEqual(C.query(S, 'recipes', { orderBy: 'minutes', desc: true }).map(r => r.title), ['Cake', 'Soup']);
  const d = C.describe({ clips: S.clips, collections: S.collections, records: S.records, meta: { title: 'Kitchen' } });
  assert.strictEqual(d.title, 'Kitchen');
  assert.deepStrictEqual(d.collections.map(c => [c.name, c.count]).sort(), [['books', 1], ['recipes', 2]]);
});

test('log entries keep values, or only paths when too large', () => {
  const small = C.logEntry({ id: 'tx:1', by: 'Ada', at: 1, label: 'x', ops: [{ store: 'clips', id: 'c', before: null, after: { t: 1 }, label: 'x' }] });
  assert.ok(!small.trimmed && small.ops[0].after.t === 1);
  const big = C.logEntry({ id: 'tx:2', by: 'Ada', at: 1, label: 'x', ops: [{ store: 'clips', id: 'c', before: null, after: { t: 'x'.repeat(300000) }, label: 'x' }] });
  assert.ok(big.trimmed && big.ops[0].trimmed && big.ops[0].after === undefined);
});

test('byteLength counts UTF-8 bytes, as the store does', () => {
  for (const s of ['', 'abc', 'é', '日本語', '😀', 'a\u0800b', '\ud800x']) {
    const want = Buffer.byteLength(s.replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, '\ufffd'), 'utf8');
    assert.strictEqual(C.byteLength(s), want, JSON.stringify(s));
  }
});

test('a log entry over the byte budget is trimmed even when its characters fit', () => {
  // 2 × 40,000 CJK characters: 80,000 UTF-16 units but about 240 KB of UTF-8.
  const text = '日'.repeat(40000);
  const e = C.logEntry({ id: 'tx:3', by: 'Ada', at: 1, label: 'x', ops: [{ store: 'clips', id: 'c', before: { t: text }, after: { t: text + '!' }, label: 'x' }] });
  assert.strictEqual(e.trimmed, true);
  assert.ok(C.byteLength(JSON.stringify(e)) < 256 * 1024);
});

test('sha256 matches the reference implementation', () => {
  const crypto = require('node:crypto');
  for (const s of ['', 'abc', 'ä€𝄞 app(\'x\')', 'x'.repeat(1000), 'y'.repeat(55), 'z'.repeat(56)]) {
    assert.strictEqual(C.sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('registering replaces the app record whole', () => {
  const { S, core } = board('admin');
  S.apps.x = { name: 'x', source: 'old', builtin: 'v1', extra: 1 };
  core.mutate(m => m.register({ name: 'x', source: 'new', version: 1 }));
  assert.deepStrictEqual(S.apps.x, { name: 'x', source: 'new', version: 1 });
});
