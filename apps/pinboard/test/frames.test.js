'use strict';
// frames.js's snapshot, without a DOM (Codex P1 on #39): an app's frame gets
// the board, never this viewer's own keys from their view document.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('a frame\'s snapshot has the board\'s shared meta only', () => {
  const meta = { title: 'Kitchen', about: 'food', seeded: 1, threads: [{ title: 'private', msgs: [{ text: 'my secret' }] }], view: { x: 1 }, agentOpen: true };
  const PB = {
    el: () => ({}), on: () => {},
    S: { clips: { 'clip:1': { id: 'clip:1', kind: 'note' } }, records: {}, collections: {}, meta, apps: { x: { name: 'x', title: 'X', source: 'secret source' } } },
    // store.js's: the shared keys only
    sharedMeta: () => ({ title: meta.title, about: meta.about, seeded: meta.seeded }),
  };
  const sandbox = { window: { PB }, document: { documentElement: { dataset: {} } }, MutationObserver: class { observe() {} }, console };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/frames.js'), 'utf8'), sandbox);
  const snap = PB.frames.snapshot();
  assert.strictEqual(JSON.stringify(snap.meta), JSON.stringify({ title: 'Kitchen', about: 'food', seeded: 1 }));
  assert.ok(!JSON.stringify(snap).includes('my secret'), 'no agent thread text');
  assert.ok(!JSON.stringify(snap).includes('secret source'), 'no app sources');
});
