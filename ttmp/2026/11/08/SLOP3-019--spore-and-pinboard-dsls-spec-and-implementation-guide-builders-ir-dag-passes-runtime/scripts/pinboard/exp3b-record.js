'use strict';
// Experiment 3b: db.record(id) and board.selection() under tracking.
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const id = PB.db.notes.insert({ t: 1 });
const keys = new Set();
PB.withCtx({ deps: keys }, () => PB.db.record(id));
console.log('db.record(id) tracked:', J([...keys]));
keys.clear(); PB.withCtx({ deps: keys }, () => PB.boardAPI.selection());
console.log('board.selection() tracked:', J([...keys]));
