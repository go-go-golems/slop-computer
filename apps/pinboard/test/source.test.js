'use strict';
// Where app source runs. Built-in apps run in the page; every other source
// runs in a sandboxed frame, including when the editor describes or registers
// it: the editor's source is shared window state, so the person pressing
// Describe IR or Register may not have written it. (Before this, both
// evaluated it in the page, where new Function code reaches window.PB.)
const test = require('node:test');
const assert = require('node:assert');
const { load, PAGE, FRAME } = require('./harness.js');

const APP = "app('probe-me').icon('P').title('Probe me').size(300, 200).state({ n: 1 })\n" +
  "  .param.slider('step', 1, { min: 1, max: 10 })\n" +
  "  .view(ui.stack(ui.text(c => 'n is ' + c.state.n), ui.button('+').on('click', (ev, c) => c.set('n', c.state.n + 1))))\n" +
  "  .register()";
const HOSTILE = 'window.__ran = (window.__ran || 0) + 1;\n' + APP;

// probe sends one probe message to a fresh frame and returns what it answers.
function probe(source) {
  const { sandbox, listeners } = load(FRAME);
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve) => {
    port1.on('message', (d) => { if (d.t === 'probed' || d.t === 'error') { port1.close(); resolve({ d, frame: sandbox }); } });
    (listeners.message || []).forEach(fn => fn({ data: { t: 'probe', source, S: { clips: {}, apps: {}, collections: {}, records: {}, meta: {} }, me: { id: 'u1', name: 'Ada' } }, ports: [port2] }));
  });
}

test('a probe frame reports what a source registers, and its view described', async () => {
  const { d } = await probe(APP);
  assert.strictEqual(d.t, 'probed');
  assert.strictEqual(d.def.name, 'probe-me');
  assert.strictEqual(d.def.title, 'Probe me');
  assert.strictEqual(d.def.w, 300);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.def.state)), { n: 1 });
  assert.strictEqual(d.def.params[0].name, 'step');
  assert.match(d.describe, /button/);
  assert.strictEqual(d.describeError, '');
});

test('a probe frame answers an error for a source that fails or registers nothing', async () => {
  assert.match((await probe('throw new Error("boom")')).d.message, /boom/);
  assert.match((await probe('const x = 1;')).d.message, /registers nothing/);
});

test('a probe frame is the only place the source ran', async () => {
  const { d, frame } = await probe(HOSTILE);
  assert.strictEqual(d.t, 'probed');
  assert.strictEqual(frame.__ran, 1, 'it ran in the frame');
});

test('the page evaluates built-in sources only', () => {
  const { sandbox } = load(PAGE);
  const PB = sandbox.PB;
  PB.apps.seed(); // the built-in apps run in the page, from their shipped source
  assert.ok(PB.builtins.editor && PB.builtins.reference, 'built-ins seeded');
  assert.throws(() => PB.apps.evalSource(HOSTILE), /only built-in apps run in this page/);
  assert.throws(() => PB.apps.evalSource(HOSTILE, { narrow: true }), /only built-in apps run in this page/);
  assert.strictEqual(sandbox.__ran, undefined, 'the refused source did not run');
});

test('Describe IR and Register go through a probe frame, never the page', async () => {
  const { sandbox } = load(PAGE);
  const PB = sandbox.PB;
  PB.apps.seed();
  const probed = [];
  PB.frames.probe = async (src) => {
    probed.push(src);
    return { def: { name: 'probe-me', icon: 'P', title: 'Probe me', about: '', shortcut: '', hidden: false, w: 300, h: 200, state: { n: 1 }, params: [] }, describe: 'stack:\n  - button', describeError: '' };
  };
  assert.strictEqual(await PB.apps.describeSource(HOSTILE), 'stack:\n  - button');
  const def = await PB.apps.registerSource(HOSTILE); // offline: this page writes the record
  assert.strictEqual(def.name, 'probe-me');
  assert.strictEqual(PB.S.apps['probe-me'].source, HOSTILE);
  assert.strictEqual(PB.S.apps['probe-me'].title, 'Probe me');
  assert.strictEqual(probed.length, 2);
  assert.strictEqual(sandbox.__ran, undefined, 'the source never ran in the page');
  // The editor's button describes through the probe, not evalSource.
  assert.ok(!PB.apps.BUILTIN.editor.includes('evalSource'));
  assert.ok(PB.apps.BUILTIN.editor.includes('c.apps.describeSource(c.state.src)'));
});

test('a probe that reports a describe error, or no name, is refused', async () => {
  const { sandbox } = load(PAGE);
  const PB = sandbox.PB;
  PB.apps.seed();
  PB.frames.probe = async () => ({ def: { name: 'x' }, describe: null, describeError: 'v.all is not a function' });
  await assert.rejects(PB.apps.describeSource('…'), /describe: v.all is not a function/);
  PB.frames.probe = async () => ({ def: {}, describe: null, describeError: '' });
  await assert.rejects(PB.apps.registerSource('…'), /without a name/);
});
