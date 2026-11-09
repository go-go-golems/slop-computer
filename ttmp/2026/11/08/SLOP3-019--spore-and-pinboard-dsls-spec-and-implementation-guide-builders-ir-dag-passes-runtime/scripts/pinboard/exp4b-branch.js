'use strict';
// Experiment 4b: reads inside a ui.when branch given as a function, and
// inside a ui.each item function, are not dependency keys (render.js:137-138).
const { load, html, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const { ui } = PB;
PB.db.other.insert({ a: 1 }); PB.db.tags.insert({ a: 1 });
const clip = { id: 'clip:test', kind: 'note', state: { n: 1 } };
PB.S.clips[clip.id] = clip;
const view = ui.stack(
  ui.when(c => c.state.n > 0, c => ui.text(String(c.db.other.count()) + ' other')),
  ui.when(c => c.state.n > 0, ui.text(c => String(c.db.other.count()) + ' other (lambda prop)')),
  ui.each([1], (x, i, c) => ui.text(c.db.tags.count() + ' tags')),
);
const ctx = PB.makeCtx(clip);
console.log(html(PB.render(view, ctx)));
console.log('deps:', J([...ctx.deps]));
