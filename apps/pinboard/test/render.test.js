'use strict';
// render.js's context, without a DOM: makeCtx only reads PB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(def, clip) {
  const PB = { ui: {}, S: { clips: { [clip.id]: clip } }, local: {}, apps: { def: () => def }, setState: () => {}, setLocal: () => {} };
  const sandbox = { window: { PB }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/render.js'), 'utf8'), sandbox);
  return PB;
}

test('a window reads the app\'s declared defaults for keys it never stored', () => {
  // An app registered before records kept state: its window was opened with
  // no state at all (SLOP3-017 F7).
  const def = { name: 'counter', state: { n: 0, items: ['a'], label: 'count' } };
  const clip = { id: 'clip:1', kind: 'app', app: 'counter', state: { label: 'mine' } };
  const PB = load(def, clip);
  const ctx = PB.makeCtx(clip);
  assert.strictEqual(ctx.state.n, 0);
  assert.strictEqual(ctx.state.n + 1, 1); // not NaN
  assert.strictEqual(ctx.state.label, 'mine', 'stored state wins');
  assert.deepStrictEqual(Object.keys(ctx.state).sort(), ['items', 'label', 'n']);
  assert.ok('n' in ctx.state && !('other' in ctx.state));
  // An object default is this context's copy: changing it leaves the definition alone.
  ctx.state.items.push('b');
  // (values made inside the vm context have its prototypes: compare as JSON)
  assert.strictEqual(JSON.stringify(ctx.state.items), '["a","b"]', 'the same copy within a context');
  assert.strictEqual(JSON.stringify(def.state.items), '["a"]');
  // Stored values are not copied.
  clip.state.items = ['x'];
  assert.strictEqual(ctx.state.items, clip.state.items);
});

test('a window without an app definition reads only its stored state', () => {
  const clip = { id: 'clip:2', kind: 'note', state: { a: 1 } };
  const PB = load(null, clip);
  const ctx = PB.makeCtx(clip);
  assert.strictEqual(ctx.state.a, 1);
  assert.strictEqual(ctx.state.b, undefined);
});
