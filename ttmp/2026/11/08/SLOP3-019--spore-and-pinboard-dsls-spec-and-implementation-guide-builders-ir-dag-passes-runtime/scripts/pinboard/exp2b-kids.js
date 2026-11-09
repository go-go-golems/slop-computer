'use strict';
// Experiment 2b: how container children are normalised (kids(), dsl.js:161).
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const { ui } = PB;
const show = (b) => b.children.map(c => Array.isArray(c) ? 'ARRAY(' + c.length + ')' : c && c._isBuilder ? c.kind + ':' + c.props.value : String(c));
console.log('one level:', J(show(ui.row('a', 2, null, false, undefined, 0, '', [ui.text('b'), 'c']))));
console.log('two levels:', J(show(ui.row([ui.text('b'), ['c']]))));
const two = ui.row([ui.text('b'), ['c']]);
try { console.log('two levels build:', J(two.build().nodes.map(n => n.kind))); } catch (e) { console.log('two levels build THROWS', e.message); }
try { console.log('two levels describe:\n' + two.describe()); } catch (e) { console.log('two levels describe THROWS', e.message); }
