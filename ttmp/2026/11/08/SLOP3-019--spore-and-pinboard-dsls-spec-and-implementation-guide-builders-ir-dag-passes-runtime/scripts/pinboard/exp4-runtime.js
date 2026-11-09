'use strict';
// Experiment 4: the runtime. Render an app window's view with a context,
// read its dependency keys, fire events, and replay board.js's invalidation
// rule (B.onChange) with renderClip/renderAll stubbed to record calls.
// node exp4-runtime.js <apps/pinboard>
const { load, html, find, fire, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const toasts = []; PB.toast = (m) => toasts.push(String(m));
const t = (name, fn) => { try { const v = fn(); console.log(name + ': ' + (typeof v === 'string' ? v : J(v))); } catch (e) { console.log(name + ': THROWS ' + e.constructor.name + ': ' + e.message); } };
PB.apps.seed();

// A test app, installed like a built-in so that it runs in this realm.
const SRC = [
  "app('probe').title('Probe').state({ n: 0, items: [] })",
  "  .param.slider('step', 1, { min: 1, max: 5 })",
  "  .view(ui.stack(",
  "    ui.text().bind(c => c.state.n).id('n'),",
  "    ui.button('+').on('click', (ev, c) => c.set('n', c.state.n + c.param('step'))),",
  "    ui.text(c => c.db.recipes.count() + ' recipes').id('count'),",
  "    ui.each(c => c.db.recipes.all(), r => ui.text(r.title + ' / ' + c0(r))).id('rows'),",
  "    ui.when(c => c.state.n > 0, c => ui.text(String(PB.db.other.count()))),",
  "    ui.text(c => { throw new Error('boom'); }).id('bad'),",
  "    ui.button('fail').on('click', () => { throw new Error('handler failed'); }),",
  "    ui.input('q').local(),",
  "    ui.segmented('step', [1, 2, 3]),",
  "  ))",
  "  .register()",
].join('\n').replace('c0(r)', "(PB.db.tags.count())");
const def0 = PB.apps.evalSource(SRC);
const rec = { name: 'probe', source: SRC, title: 'Probe', builtin: 'test' };
PB.builtins.probe = rec; PB.S.apps.probe = rec;
PB.db.recipes.insert({ title: 'Soup' });

const clipId = PB.mutate(m => m.open('probe'));
const clip = PB.S.clips[clipId];
t('opened window (state copied from def, params from defaults)', () => ({ id: clip.id, kind: clip.kind, app: clip.app, state: clip.state, params: clip.params, w: clip.w, h: clip.h }));
const def = PB.apps.def('probe');
const ctx = PB.makeCtx(clip);
t('ctx keys', () => Object.keys(ctx));
const dom = PB.render(def.view, ctx);
t('rendered DOM', () => html(dom));
t('window deps after render', () => [...ctx.deps]);
t('deps NOT seen: the each item fn read db.tags; the when branch fn read db.other', () => ['coll:tags', 'coll:other'].map(k => k + '=' + ctx.deps.has(k)));

// events
const plus = find(dom, n => n.tagName === 'BUTTON' && n.textContent === '+');
let changed = null; const off = PB.on('change', (ks) => { changed = [...ks]; });
fire(plus, 'click');
off();
t('click + → c.set → PB.setState emits', () => changed);
t('state after click', () => PB.S.clips[clipId].state);
t('history after click (setState is not a transaction)', () => PB.history.txs.map(x => x.label));
fire(find(dom, n => n.tagName === 'BUTTON' && n.textContent === 'fail'), 'click');
t('a throwing handler → toast', () => toasts);
const seg = find(dom, n => n.className === 'seg');
fire(seg.children[2], 'click');
t('segmented bound to a param → setParam is a transaction', () => [PB.S.clips[clipId].params, PB.history.txs.map(x => x.label)]);

// invalidation: board.js B.onChange, with rendering stubbed
const B = PB.board;
const calls = [];
B.renderClip = (id) => calls.push('renderClip ' + id); B.renderAll = () => calls.push('renderAll'); B.renderDock = () => calls.push('renderDock');
const other = PB.mutate(m => m.place({ kind: 'note', text: 'other' }));
B.wins[clipId] = { deps: ctx.deps }; B.wins[other] = { deps: new Set() };
const onChange = (label, keys) => { calls.length = 0; try { B.onChange(new Set(keys)); } catch (e) { /* $pins is only set by B.init */ } console.log('onChange ' + label + ' ' + J(keys) + ' → ' + J(calls)); };
onChange('state of this window', ['state:' + clipId + ':n']);
onChange('state of another window', ['state:' + other + ':n']);
onChange('a record in a collection this window reads', ['records', 'records:rec:x', 'coll:recipes']);
onChange('a record in a collection this window does NOT read', ['records', 'records:rec:y', 'coll:unrelated']);
onChange('a record: only the coll key', ['coll:unrelated']);
onChange('another clip moved', ['clips', 'clips:' + other]);
onChange('this window\'s own param (setParam → clips:<id>)', ['clips', 'clips:' + clipId]);
onChange('local key of this window', ['local:' + clipId + ':q']);
onChange('app record changed', ['apps', 'apps:probe']);
onChange('schema of a collection', ['collections', 'collections:recipes']);

// the frame's version of a window ignores deps: it redraws on every sync
console.log('\nframe.js draw(): redraw() on every sync message (frame.js:145) and after its own setState/setLocal/mutate (frame.js:47-62), no deps.');

// describe for the agent
t('PB.describe().apps (built-ins + probe) names and describe()', () => PB.describe({ clips: false, collections: false }).apps.map(a => [a.name, a.params, a.describe]));
