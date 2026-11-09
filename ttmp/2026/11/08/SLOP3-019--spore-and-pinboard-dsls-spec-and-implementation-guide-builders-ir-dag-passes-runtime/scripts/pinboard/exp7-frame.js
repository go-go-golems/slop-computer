'use strict';
// Experiment 7: an app inside its frame. Loads the frame document's scripts
// in the frame's order (frames.js:187-190: steps, frame, dsl, render), sends
// the init message with a port, and records what the frame posts back.
// node exp7-frame.js <apps/pinboard>
const { load, html, find, fire, J } = require('./harness.js');
let onMessage = null;
const root = { el: null };
const { PB, El } = load(process.argv[2], {
  files: ['js/steps.js', 'js/frame.js', 'js/dsl.js', 'js/render.js'],
  setup: (sb) => {
    sb.addEventListener = (ev, fn) => { if (ev === 'message') onMessage = fn; };
    sb.removeEventListener = () => {};
    sb.document.getElementById = (id) => (id === 'root' ? root.el : null);
  },
});
root.el = new El('div');
const sent = [];
const port = { postMessage: (m) => sent.push(m), onmessage: null };
const SRC = [
  "app('framed').title('Framed').state({ n: 0 }).param.toggle('big', false)",
  "  .view(ui.stack(",
  "    ui.text(c => 'n=' + c.state.n + ' recs=' + c.db.notes.count() + ' agent=' + c.agent() + ' apps=' + Object.keys(c.apps)),",
  "    ui.button('+').on('click', (ev, c) => c.set('n', c.state.n + 1)),",
  "    ui.button('add').on('click', (ev, c) => c.db.notes.insert({ t: 'new' })),",
  "    ui.button('edit').on('click', (ev, c) => c.mutate(m => m.update('notes', 'rec:aaaaaaaaaa', r => { delete r.old; return { t: r.t + '!' }; }))),",
  "    ui.button('clip').on('click', (ev, c) => c.board.clip(ui.note('x'))),",
  "    ui.button('focus').on('click', (ev, c) => c.board.focus('clip:x')),",
  "    ui.button('reg').on('click', (ev, c) => c.mutate(m => m.register({ name: 'x' }))),",
  "  ))",
  "  .register()",
].join('\n');
const clip = { id: 'clip:frameaaaaa', kind: 'app', app: 'framed', state: {} };
const S = { clips: { [clip.id]: clip }, records: { 'rec:aaaaaaaaaa': { id: 'rec:aaaaaaaaaa', coll: 'notes', t: 'one', old: 1 } }, collections: { notes: { name: 'notes', fields: [] } }, apps: {}, meta: {} };
const PRISTINE = JSON.stringify(S);
onMessage({ data: { t: 'init', app: { name: 'framed', source: SRC, version: 1 }, clip, S: JSON.parse(PRISTINE), local: {}, sel: [], log: [], me: { id: 'u1', name: 'Ada' }, theme: 'light' }, ports: [port] });
console.log('frame → page after init:', J(sent));
console.log('frame DOM:', html(root.el));
const btn = (label) => find(root.el, n => n.tagName === 'BUTTON' && n.textContent === label);
const click = (label) => { sent.length = 0; try { fire(btn(label), 'click'); } catch (e) { sent.push({ thrown: e.message }); } console.log('click ' + label + ' → ' + J(sent)); };
click('+'); click('add'); click('edit'); click('clip'); click('focus'); click('reg');
setTimeout(() => {
  console.log('frame copy after its own steps (optimistic):', J(Object.values(PB.S.records).map(r => [r.id.length, r.t, 'old' in r])));
  // page acknowledges batch 2 with a fresh copy that lacks the frame's insert: pending later batches are laid over it
  port.onmessage({ data: { t: 'sync', S: JSON.parse(PRISTINE), sel: [], log: [], ack: 1 } });
  console.log('after sync ack=1 (batches >1 re-applied):', J(Object.values(PB.S.records).map(r => r.t)));
  port.onmessage({ data: { t: 'sync', S: JSON.parse(PRISTINE), sel: [], log: [], ack: 99 } });
  console.log('after sync ack=99 (page copy wins):', J(Object.values(PB.S.records).map(r => r.t)));
}, 20);
