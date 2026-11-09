'use strict';
// Experiment 5: the built-in editor's "Describe IR" button evaluates the
// editor window's shared state.src in the page realm (apps.js:220, evalSource
// without narrow, apps.js:35-44). Whoever can write that window's state
// (anyone at interact, or a framed app via m.setState) chooses the code.
const { load, html, find, fire, J } = require('./harness.js');
const { PB, sandbox } = load(process.argv[2]);
PB.toast = () => {};
PB.apps.seed();
// 1. Typing in the editor writes shared state (not .local()).
const id = PB.mutate(m => m.open('editor'));
const def = PB.apps.def('editor');
let ctx = PB.makeCtx(PB.S.clips[id]);
const view = PB.render(def.view, ctx);
const ta = find(view, n => n.tagName === 'TEXTAREA');
ta.value = "app('typed').view(ui.text('x')).register()"; fire(ta, 'input');
console.log('after typing, clip.state.src (saved with the clip, seen by everyone):', J(PB.S.clips[id].state.src));
// 2. A step a framed app may send (steps.js OPS.setState: [id, obj]) puts code there.
const Steps = sandbox.PinboardSteps;
const evil = "window.__ran = { PB: typeof window.PB, claude: typeof window.claude, rt: Object.keys(window.PB.rt) }; app('decoy').view(ui.text('fine')).register()";
const args = Steps.check('setState', [id, { src: evil }], { has: () => true, fromClip: () => ({}) });
PB.mutate(m => m[ 'setState' ](...args), 'app:other');
console.log('a framed app\'s setState step on the editor window: accepted, state.src now', J(PB.S.clips[id].state.src.slice(0, 40) + '…'));
// 3. The person presses "Describe IR".
ctx = PB.makeCtx(PB.S.clips[id]);
const tb = PB.render(def.toolbar, ctx);
fire(find(tb, n => n.tagName === 'BUTTON' && n.textContent === 'Describe IR'), 'click');
console.log('window.__ran after Describe IR:', J(sandbox.__ran));
console.log('editor ok text:', J((PB.S.clips[id].state.ok || '').slice(0, 60)));
