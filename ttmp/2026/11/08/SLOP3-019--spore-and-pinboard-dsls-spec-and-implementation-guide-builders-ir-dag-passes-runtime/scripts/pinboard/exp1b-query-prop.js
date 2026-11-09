'use strict';
// Experiment 1b: a query object (not a lambda) as ui.each's source, as the
// guide and the Reference allow: build, toYAML, describe, PB.toYAML.
// node exp1b-query-prop.js <apps/pinboard>
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const { ui } = PB;
const t = (name, fn) => { try { const v = fn(); console.log(name + ': ok ' + (typeof v === 'string' ? '\n' + v : J(v))); } catch (e) { console.log(name + ': THROWS ' + e.constructor.name + ': ' + e.message); } };
const b = ui.each(PB.db.links.where(l => true), l => ui.link(l.url)).id('results');
t('build().nodes.length', () => b.build().nodes.length);
t('build().node("results").props (raw)', () => Object.keys(b.build().node('results').props.src));
t('PB.stripIR(root).props.src', () => PB.stripIR(b.build().root).props.src);
t('build().toYAML()', () => b.build().toYAML());
t('describe()', () => b.describe());
t('PB.toYAML(builder)', () => PB.toYAML(b));
t('same with a lambda source: describe()', () => ui.each(c => c.db.links.all(), l => ui.link(l.url)).id('r').describe());
t('ui.table(query) describe()', () => ui.table(PB.db.links.orderBy('added')).describe());
