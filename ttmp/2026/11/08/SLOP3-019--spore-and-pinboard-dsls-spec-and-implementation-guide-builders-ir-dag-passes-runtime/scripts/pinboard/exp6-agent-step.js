'use strict';
// Experiment 6: an agent step that registers an app. runCode runs the step
// as an async function with the agent's scope (agent.js:69-76), then, if it
// captured an app, registers the step's whole code as the source
// (agent.js:77), which evaluates it again with evalSource's scope (apps.js:38).
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
PB.toast = () => {};
PB.apps.seed();
(async () => {
  const steps = {
    plain: "app('a1').view(ui.text('x')).register()",
    withReturn: "app('a2').view(ui.text('x')).register(); return 'done'",
    withAwait: "const n = await Promise.resolve(1); app('a3').view(ui.text('x' + n)).register()",
    withLog: "log('making a4'); app('a4').view(ui.text('x')).register()",
    withM: "m(x => x.place({ kind: 'note', text: 'side effect' })); app('a5').view(ui.text('x')).register()",
    strictEach: "app('a6').view(ui.each(c => [], x => ui.text(x))).register()",
  };
  for (const [k, code] of Object.entries(steps)) {
    const before = Object.keys(PB.S.clips).length;
    const r = await PB.agent.runCode(code, { by: 'agent' });
    const name = 'a' + (Object.keys(steps).indexOf(k) + 1);
    console.log(k + ': error=' + J(r.error ? r.error.message : null) + ' registered=' + J(!!PB.S.apps[name]) + ' clipsAdded=' + (Object.keys(PB.S.clips).length - before) + ' out=' + J(r.out.slice(0, 160)));
  }
  console.log('PB.strict during agent steps:', J(PB.strict));
})();
