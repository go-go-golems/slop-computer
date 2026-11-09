'use strict';
// Experiment 9: the IR of the counter template (apps.js:154-171), exactly as
// the editor's "Describe IR" button computes it (apps.js:220).
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const def = PB.apps.evalSource(PB.apps.TEMPLATE);
console.log('def keys:', J(Object.keys(def)));
console.log('def (data part):', J({ name: def.name, icon: def.icon, title: def.title, about: def.about, w: def.w, h: def.h, state: def.state, params: def.params }));
console.log('agentDescribe is a', typeof def.agentDescribe);
const ir = def.view.build();
console.log('\nnodes (array order):');
ir.nodes.forEach(n => console.log('  ' + J({ kind: n.kind, id: n.id, path: n.path, props: n.props, children: n.children.map(c => c && c.id), handlers: n.handlers, frags: n.frags, attrs: n.attrs, deps: n.deps })));
console.log('\nDescribe IR (def.view.describe()):\n' + def.view.describe());
const wider = PB.apps.evalSource(PB.apps.TEMPLATE.replace('.pad(12).gap(10)', '.pad(16).gap(10)'));
console.log('\ndiff after changing pad 12 → 16:', J(ir.diff(wider.view.build())));
const label = PB.apps.evalSource(PB.apps.TEMPLATE.replace("ui.button('reset')", "ui.button('zero')"));
console.log('diff after renaming the reset button:', J(ir.diff(label.view.build())));
