'use strict';
// Experiment 10: a schema declared at the top of an app's source (guide
// ch.13) writes the collection every time the source is evaluated, and fails
// for a viewer who may not write.
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const SRC = "db.collection('moodboard').field('src', 'image').required().field('caption', 'text').index('tags');\napp('mb').view(ui.text('x')).register()";
for (let i = 1; i <= 3; i++) { PB.apps.evalSource(SRC); console.log('after evaluation ' + i + ': transactions=' + PB.history.txs.length + ' ops in last=' + PB.history.txs[PB.history.txs.length - 1].ops.length); }
PB.rt.level = 'view';
try { PB.apps.evalSource(SRC); console.log('as a viewer: ok'); } catch (e) { console.log('as a viewer: THROWS ' + e.message); }
