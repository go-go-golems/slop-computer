'use strict';
// Experiment 1: the build pass and the IR, for a small app and for the
// guide's chapter 06 example (adapted to what the code accepts).
// node exp1-ir.js <apps/pinboard>
const { load, J } = require('./harness.js');
const { PB } = load(process.argv[2]);
const { ui } = PB;
const say = (title, v) => console.log('\n=== ' + title + '\n' + (typeof v === 'string' ? v : J(v)));
const tryIt = (title, fn) => { try { say(title, fn()); } catch (e) { say(title + ' THROWS', e.constructor.name + ': ' + e.message); } };

// A small view: the counter template's view, plus an each over a query.
const view = ui.stack(
  ui.text().bind(c => c.state.n).bold().class('bignum'),
  ui.row(
    ui.button('−').on('click', (ev, c) => c.set('n', c.state.n - 1)),
    ui.button('+').on('click', (ev, c) => c.set('n', c.state.n + 1)),
    'a plain string child',
  ).gap(6),
  ui.when(c => c.state.n > 3, ui.text('big'), ui.text('small')),
  ui.each(c => c.db.links.where(l => true), l => ui.link(l.url)).id('results'),
).pad('m').gap(10);

const ir = view.build();
say('ir keys', Object.keys(ir));
say('ir.nodes (kind, id, path) in array order', ir.nodes.map(n => [n.kind, n.id, n.path]));
say('ir.root.id', ir.root.id);
say('one node, full (minus _b)', (() => { const n = ir.nodes[0]; const o = {}; Object.keys(n).forEach(k => { if (k !== '_b') o[k] = n[k]; }); return o; })());
say('field types of a node', Object.fromEntries(Object.entries(ir.root).map(([k, v]) => [k, Array.isArray(v) ? 'array' : typeof v])));
say('ir.node("results")', (() => { const n = ir.node('results'); return { kind: n.kind, id: n.id, path: n.path, props: n.props, deps: n.deps }; })());
say('ir.node("nope")', String(ir.node('nope')));
say('ir.edges (a getter)', ir.edges);
tryIt('ir.edges() as the guide calls it', () => ir.edges());
say('every node.deps', ir.nodes.map(n => n.deps.length));
say('ir.toYAML()', ir.toYAML());
say('view.describe() === ir.toYAML()', String(view.describe() === ir.toYAML()));
say('view.toYAML === view.describe', String(view.toYAML() === view.describe()));

// diff
const ir2 = view.gap(12).build();
say('ir.diff(view.gap(12).build())', ir.diff(ir2));
tryIt('ir.diff(builder) (code tries other.root first)', () => ir.diff(view.gap(12)));
const ir3 = ui.stack(ui.text('x'), ...[]).build();
say('ir.diff of a structurally different tree', ir.diff(ir3).slice(0, 6));
// lambda changes are invisible to diff
const a = ui.text().bind(c => 1).build(), b = ui.text().bind(c => 2).build();
say('diff of two different lambdas', a.diff(b));
// inserting a node shifts auto ids
const s1 = ui.stack(ui.text('a'), ui.text('b')).build();
const s2 = ui.stack(ui.text('new'), ui.text('a'), ui.text('b')).build();
say('auto ids before / after inserting a first child', [s1.nodes.map(n => n.id), s2.nodes.map(n => n.id)]);
say('diff after inserting a first child', s1.diff(s2));

// duplicate ids
const dup = ui.stack(ui.text('one').id('x'), ui.text('two').id('x')).build();
say('duplicate .id("x"): nodes / node("x").props.value', [dup.nodes.map(n => n.id), dup.node('x').props.value]);

// a shared builder appears twice (tree, not DAG)
const shared = ui.text('shared');
const twice = ui.row(shared, shared).build();
say('a builder used twice: node ids, same IR object?', [twice.nodes.map(n => n.id), String(twice.root.children[0] === twice.root.children[1])]);

// ui.list expands at build time
const lst = ui.list(['a', 'b'], (x, i) => i === 0 ? ui.text(x) : x).build();
say('ui.list children (a builder and a raw string)', lst.root.children.map(c => (c && c.kind) || c));

// builder-valued props (when branches, caption, footer) become nodes
const w = ui.image('blob:x').caption(ui.text('cap')).footer(ui.text('f1')).footer(ui.text('f2')).build();
say('builder-valued props → IR nodes with paths', w.nodes.map(n => [n.kind, n.id, n.path]));

// the toYAML formatter on a builder, a query, an app
say('PB.toYAML(builder)', PB.toYAML(ui.row(ui.text('x')).gap(4)));
const appB = PB.app('counter').icon('△').state({ n: 0 }).param.slider('step', 1, { min: 1, max: 10 }).view(view);
say('app(...).toYAML()', appB.toYAML());
say('app(...).build() keys', Object.keys(appB.build()));

// strict
PB.ui.strict(true);
tryIt('strict: ui.each without .id() at build', () => ui.each([], x => ui.text(x)).build().nodes.length);
PB.ui.strict(false);
say('not strict: ui.each without .id() at build (no warning)', ui.each([], x => ui.text(x)).build().nodes.map(n => n.id));

// the guide's chapter 06 example, as far as the code accepts it
tryIt('guide ch.06 search example build', () => {
  const search = ui.row(
    ui.input('q').id('search'),
    ui.each(PB.db.links.where(c => l => l.title.includes(c.state.q)), l => ui.link(l.url)).id('results'),
    ui.text(c => `${c.ir('results').count} of ${c.db.links.count()}`).id('count'),
  );
  const r = search.build();
  return { nodes: r.nodes.length, resultsDeps: r.node('results').deps, countDeps: r.node('count').deps, edges: r.edges, yaml: r.toYAML() };
});
tryIt('guide ch.06 ui.ref', () => ui.ref('search'));
tryIt('guide ch.06 .ref()', () => ui.text('x').ref('search'));
