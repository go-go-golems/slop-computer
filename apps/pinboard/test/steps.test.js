'use strict';
// The frame protocol (SLOP3-017 F6): an app's steps applied through its frame
// (recorded as data there, sent, checked by the page) must change the board
// exactly as the same calls made in the page.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../core.js');
const Steps = require('../js/steps.js');

function board() {
  const S = { clips: {}, apps: {}, collections: {}, records: {} };
  let z = 0;
  const core = C.createCore({
    get: (s, i) => S[s][i],
    put: (s, i, v) => { if (v == null) delete S[s][i]; else S[s][i] = v; },
    list: (s) => Object.values(S[s]),
    level: () => 'admin',
    now: () => 1000,
    z: () => ++z,
  });
  core.mutate(m => {
    m.place({ id: 'clip:aaaaaaaaaa', kind: 'note', text: 'one', tags: ['x', 'y'] });
    m.place({ id: 'clip:bbbbbbbbbb', kind: 'link', url: 'https://example.com', title: 'link' });
    m.insert('recipes', { id: 'rec:aaaaaaaaaa', title: 'Soup', minutes: 20, old: 'gone' });
  });
  S.apps.counter = { name: 'counter', title: 'Counter', w: 300, h: 200, state: { n: 0 }, params: [{ name: 'step', def: 1 }] };
  return { S, core };
}

// In the page: core runs the calls.
function direct(calls) {
  const b = board();
  const result = b.core.mutate(m => calls(m)).result;
  return { S: b.S, result };
}

// Through a frame: the frame records against its copy, the steps cross as
// JSON, the page checks them and core runs them.
function framed(calls) {
  const b = board();
  const copy = JSON.parse(JSON.stringify(b.S));
  const rec = Steps.recorder((s, id) => copy[s][id]);
  const result = calls(rec.m);
  const wire = JSON.parse(JSON.stringify(rec.steps));
  const page = { has: (s, id) => !!b.S[s][id], fromClip: C.fromClip };
  const checked = wire.map(s => [s.op, Steps.check(s.op, s.args, page)]);
  b.core.mutate(m => checked.forEach(([op, args]) => m[op](...args)));
  return { S: b.S, result, steps: wire };
}

const cases = {
  'clip edits': (m) => {
    m.move('clip:aaaaaaaaaa', { x: 40, y: 50 });
    m.resize('clip:aaaaaaaaaa', { w: 300, h: 200 });
    m.retitle('clip:bbbbbbbbbb', 'renamed');
    m.tag('clip:bbbbbbbbbb', 'a', 'b');
    m.untag('clip:aaaaaaaaaa', 'x');
    m.setAttr('clip:aaaaaaaaaa', { note: 'n', color: 'red' });
    m.pin('clip:aaaaaaaaaa');
    m.pin('clip:bbbbbbbbbb', false);
  },
  'window state and params': (m) => {
    const id = m.open('counter', { id: 'clip:dddddddddd' });
    m.setParam(id, 'step', 3);
    m.setState(id, { n: 2 });
    return id;
  },
  'place, remove, close': (m) => {
    const id = m.place({ id: 'clip:cccccccccc', kind: 'note', text: 'new' });
    m.remove('clip:bbbbbbbbbb');
    m.close('clip:aaaaaaaaaa');
    return id;
  },
  'records with data patches': (m) => {
    m.collection('books', { fields: [{ name: 't', type: 'text' }] });
    const id = m.insert('books', { id: 'rec:bbbbbbbbbb', t: 'Dune' });
    m.update('recipes', 'rec:aaaaaaaaaa', { minutes: 25 });
    return id;
  },
  'records with function patches': (m) => {
    m.update('recipes', 'rec:aaaaaaaaaa', r => ({ minutes: r.minutes + 5 }));
    // a rename, as dsl.js's schema builder does it: mutate and return
    m.update('recipes', 'rec:aaaaaaaaaa', x => { x.name = x.title; delete x.title; return x; });
    // a deletion without a return value
    m.update('recipes', 'rec:aaaaaaaaaa', r => { delete r.old; });
  },
  'insert then update in one transaction': (m) => {
    const id = m.insert('books', { id: 'rec:eeeeeeeeee', t: 'Dune', n: 1 });
    m.update('books', id, r => ({ n: r.n + 1 }));
    return id;
  },
  'promote with a mapping, then demote': (m) => {
    const id = m.promote('clip:aaaaaaaaaa', 'notes', c => ({ text: c.text.toUpperCase(), id: 'rec:cccccccccc' }));
    m.demote('clip:aaaaaaaaaa');
    return id;
  },
  'remove a record': (m) => { m.removeRecord('recipes', 'rec:aaaaaaaaaa'); },
};

for (const [name, calls] of Object.entries(cases)) {
  test('framed equals direct: ' + name, () => {
    const a = direct(calls), b = framed(calls);
    assert.deepStrictEqual(b.S, a.S);
    assert.deepStrictEqual(b.result, a.result);
  });
}

test('function patches cross the frame as data', () => {
  const { steps } = framed(cases['records with function patches']);
  assert.deepStrictEqual(steps.map(s => s.args[2]), [
    { set: { minutes: 25 }, unset: [] },
    { set: { name: 'Soup' }, unset: ['title'] },
    { set: {}, unset: ['old'] },
  ]);
});

test('promote without a mapping uses the page\'s fromClip, under the frame\'s id', () => {
  const { S, result } = framed((m) => m.promote('clip:bbbbbbbbbb', 'links'));
  assert.match(result, /^rec:[a-z0-9]{10}$/);
  assert.strictEqual(S.records[result].url, 'https://example.com');
  assert.deepStrictEqual(S.clips['clip:bbbbbbbbbb'].binding, { coll: 'links', id: result });
});

test('the page refuses what is not in the table or not in shape', () => {
  const page = { has: () => false, fromClip: C.fromClip };
  const refused = [
    ['register', [{ name: 'x' }], /may not register/],
    ['removeCollection', ['recipes'], /may not/],
    ['__proto__', [], /may not/],
    ['move', ['clip:aaaaaaaaaa', 'far away'], /not point/],
    ['update', ['recipes', 'rec:aaaaaaaaaa', null], /not patch/],         // once a silent no-op
    ['update', ['recipes', 'rec:aaaaaaaaaa', { minutes: 1 }], /not patch/], // a raw patch is not the wire form
    ['place', [{ kind: 'app', app: 'counter' }], /m\.open/],
    ['retitle', ['clip:aaaaaaaaaa'], /missing/],
    ['remove', ['clip:aaaaaaaaaa', 'extra'], /too many/],
    ['tag', ['clip:aaaaaaaaaa', 'ok', 7], /not str/],
    ['move', null, /no arguments/],
  ];
  for (const [op, args, re] of refused) assert.throws(() => Steps.check(op, args, page), re, op);
});

test('what an app may not set or name is taken out', () => {
  const page = { has: (s, id) => id === 'clip:taken00000', fromClip: C.fromClip };
  const [, patch] = Steps.check('setAttr', ['clip:aaaaaaaaaa', { id: 'clip:other', kind: 'app', app: 'x', note: 'ok' }], page);
  assert.deepStrictEqual(patch, { note: 'ok' });
  const [c] = Steps.check('place', [{ id: 'clip:taken00000', kind: 'note' }], page);
  assert.ok(!('id' in c), 'a taken id is dropped');
  const [c2] = Steps.check('place', [{ id: 'not-an-id', kind: 'note' }], page);
  assert.ok(!('id' in c2), 'a malformed id is dropped');
});

test('the frame refuses functions where data is expected, and unknown steps', () => {
  const rec = Steps.recorder(() => undefined);
  assert.throws(() => rec.m.setAttr('clip:aaaaaaaaaa', { note: () => 1 }), /must be data/);
  assert.throws(() => rec.m.setState('clip:aaaaaaaaaa', () => ({})), /must be data/);
  assert.throws(() => rec.m.register({ name: 'x' }), /not available to board apps/);
  assert.throws(() => rec.m.update('recipes', 'rec:nothere000', { a: 1 }), /no record/);
  assert.strictEqual(rec.steps.length, 0);
});
