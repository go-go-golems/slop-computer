// SLOP3-003 B1: build the blocks-site test workspace, fold it and render it
// with apps/blocks-site/lib exactly as the actor loads it (a CommonJS
// require over the app's files, in a context with no DOM).
//
//   node 02-render-fixture.mjs <slop-v3 repo> <out-dir>
//
// Writes <repo>/pkg/server/testdata/blocks-site-fixture.json (the
// workspace's documents, used by the Go tests), then <out-dir>/live/*.html
// (the reader's pages) and <out-dir>/static/** (the static files).
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const [REPO, OUT] = process.argv.slice(2);
const APP = path.join(REPO, 'apps/blocks-site');

// ---- the workspace -------------------------------------------------------
const hash32 = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; };
const peerOf = (by, role = 'you') => 'u' + hash32(by).toString(36) + ':' + role;
const ADA = 'usr_ada', MAL = 'usr_mallory', T0 = 1793600000000;
const ada = peerOf(ADA), mal = peerOf(MAL);
let n = 0;
const op = (peer, clock, text, at) => ['op' + (n++).toString(36).padStart(3, '0'), peer, clock, text, at];

// The checkpoint holds the first page's title, icon and heading.
const snapOps = [[ada, 1, 'weft.title = "Weft"'], [ada, 2, 'weft.icon = "🧶"'], [ada, 3, 'weft.ui.0.k = "h1"'], [ada, 3, 'weft.ui.0.text = "Yarn for people who knit in public"']];
// c-a-0: three ops the checkpoint already holds, then one it does not.
const a0 = [op(ada, 1, 'weft.title = "Weft"', T0 - 3000), op(ada, 2, 'weft.icon = "🧶"', T0 - 2000), op(ada, 3, 'weft.ui.0 is h1 "Yarn for people who knit in public"', T0 - 1000),
  op(ada, 4, 'weft.ui.1 is p "OLD INTRO TEXT"', T0 + 1000)];
let c = 5, at = T0 + 2000;
const w = (text, peer = ada) => op(peer, c++, text, at += 500);
const a1 = [
  w('weft.ui.1.text = "We spin **small batches** of *undyed* wool, ~~fast~~ slowly. See [[care]] and [our shop](https://example.com/shop)."'),
  w('weft.ui.2 is callout "Orders ship on **Mondays**.", icon: "📦"'),
  w('weft.ui.3 is toc'),
  w('weft.ui.4 is h2 "What we make"'),
  w('weft.ui.5 is bullet "Worsted, 200 m"'),
  w('weft.ui.5.0 is bullet "in three weights"'),
  w('weft.ui.6 is bullet "Fingering, 400 m", color: "blue"'),
  w('weft.ui.7 is numbered "Pick a yarn"'),
  w('weft.ui.8 is numbered "Pick a colour"'),
  w('weft.ui.9 is todo "Restock the oat colourway", done: true'),
  w('weft.ui.10 is todo "Photograph the new batch"'),
  w('weft.ui.11 is quote "The softest yarn I own."'),
  w('weft.ui.12 is code "skeins = 12"'),
  w('weft.ui.13 is divider'),
  w('weft.ui.14 is fold "Shipping details"'),
  w('weft.ui.14.0 is p "Two to four days in the EU."'),
  w('weft.ui.15 is columns'),
  w('weft.ui.15.0 is col'),
  w('weft.ui.15.0.0 is p "Left column"'),
  w('weft.ui.15.1 is col'),
  w('weft.ui.15.1.0 is p "Right column"'),
  w('weft.ui.16 is page "care"'),
  w('weft.ui.17 is h2 "Numbers"'),
  w('weft.skeins = 12'),
  w('weft.price = 18'),
  w('weft.share = 0.4'),
  w('weft.colours = [{name: "Oat", stock: 4}, {name: "Moss", stock: 8}]'),
  w('weft.ui.18 is p "We have {skeins} skeins, {skeins * price} euros of stock."'),
  w('weft.ui.19 is stat skeins, label: "Skeins"'),
  w('weft.ui.20 is progress share, label: "Sold"'),
  w('weft.ui.21 is table colours'),
  w('weft.ui.22 is p "<script>alert(1)</script> & stays text"'),
  w('weft.ui.23 is button "Press me" -> weft.skeins = weft.skeins + 1'),
  w('care:'), w('care.title = "Care"'), w('care.icon = "🫧"'), w('care.parent = "weft"'), w('care.ui.0 is p "Wash cold. Dry flat."'),
  w('faq.title = "FAQ"'), w('faq.parent = "weft"'), w('faq.ui.0 is p "Ask us anything. Back to [[weft]]."'),
  w('drafts.title = "Drafts"'), w('drafts.ui.0 is p "NOT READY FOR READERS"'),
  w('weft.ui.24 is p "Unpublished: [[drafts]]."'),
];
// Mallory writes one op as herself and one under Ada's peer: the second is forged.
const m0 = [op(mal, c++, 'weft.ui.25 is p "Mallory was here"', at += 500), op(ada, c++, 'weft.ui.26 is p "FORGED BY MALLORY"', at += 500)];
// A chunk older than the checkpoint's margin: the editor never reads it, neither does the reader.
const old = [op(ada, c++, 'weft.ui.27 is p "STALE CHUNK"', T0 - 20 * 60 * 1000)];

const docs = {
  'meta/snap': { id: 's1', at: T0, clock: 4, parts: 1, folded: { 'c-a-0': [3, a0[2][0]] } },
  'snaps/s1-0': { ops: snapOps, stamps: [] },
  'chunks/c-a-0': { by: ADA, tab: 'a', seq: 0, at: T0 + 1000, n: a0.length, ops: a0 },
  'chunks/c-a-1': { by: ADA, tab: 'a', seq: 1, at, n: a1.length, ops: a1 },
  'chunks/c-m-0': { by: MAL, tab: 'm', seq: 0, at, n: m0.length, ops: m0 },
  'chunks/c-old': { by: ADA, tab: 'o', seq: 0, at: T0 - 20 * 60 * 1000, n: 1, ops: old },
};
fs.writeFileSync(path.join(REPO, 'pkg/server/testdata/blocks-site-fixture.json'), JSON.stringify(docs, null, 1) + '\n');

// ---- the actor's require, over the app's files ----------------------------
const ctx = vm.createContext({ console, Date });
const cache = new Map();
function req(from, name) {
  const p = path.normalize(path.join(path.dirname(from), name.endsWith('.js') ? name : name + '.js'));
  if (cache.has(p)) return cache.get(p).exports;
  const module = { exports: {} };
  cache.set(p, module);
  const fn = vm.runInContext('(function (module, exports, require) {' + fs.readFileSync(p, 'utf8') + '\n})', ctx, { filename: p });
  fn(module, module.exports, (n2) => req(p, n2));
  return module.exports;
}
const entry = path.join(APP, 'actor.js');
const { fold } = req(entry, './lib/fold.js');
const site = req(entry, './lib/site.js');
const render = req(entry, './lib/render.js');

// A store handle over the documents, as use('stores').open() gives.
const snapOf = (p) => (docs[p] ? { exists: true, path: p, id: p.split('/').pop(), version: 1, data: () => docs[p] } : { exists: false, path: p, id: p.split('/').pop(), data: () => undefined });
const src = {
  id: 'ws-weft',
  docs: {
    get: snapOf,
    query: (coll, q) => Object.keys(docs).filter((p) => p.startsWith(coll + '/') && p.split('/').length === 2)
      .filter((p) => !(q && q.filters) || q.filters.every((f) => f.op === '>=' && docs[p][f.field] >= f.value)).map(snapOf),
  },
};

const t = Date.now();
const { K, ops } = fold(src);
console.log(`folded ${ops} ops in ${Date.now() - t} ms`);
const s = site.build(K, { root: 'weft' }, src.id);
console.log('pages:', s.pages.map((p) => `${p}=${s.slug(p)}`).join(' '), '| home:', s.home);
fs.mkdirSync(path.join(OUT, 'live'), { recursive: true });
const live = render.liveLinks(s, '/pub/weft-site');
for (const p of s.pages) fs.writeFileSync(path.join(OUT, 'live', (s.slug(p) || 'home') + '.html'), render.page(s, p, { ...live, admin: { source: src.id, href: '/pub/weft-site/_site' } }));
fs.writeFileSync(path.join(OUT, 'live', '_site.html'), render.adminPage(s, { base: '/pub/weft-site', source: src.id, rev: 42, published: null, note: '' }));
for (const f of render.staticFiles(s)) {
  fs.mkdirSync(path.dirname(path.join(OUT, 'static', f.path)), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'static', f.path), f.text);
}
const home = fs.readFileSync(path.join(OUT, 'static', 'index.html'), 'utf8');
for (const [what, ok] of [
  ['checkpoint content (title, heading)', home.includes('🧶') && home.includes('Yarn for people who knit in public')],
  ['overwritten text is gone', !home.includes('OLD INTRO TEXT')],
  ['forged op ignored, own op kept', !home.includes('FORGED') && home.includes('Mallory was here')],
  ['stale chunk ignored', !home.includes('STALE CHUNK')],
  ['scope: drafts not published, not titled', !s.has('drafts') && !home.includes('NOT READY') && home.includes('<span class="mention">drafts</span>')],
  ['prose', home.includes('<strong>small batches</strong>') && home.includes('<em>undyed</em>') && home.includes('<s>fast</s>') && home.includes('href="https://example.com/shop"')],
  ['formulas', home.includes('We have <span class="val">12</span> skeins, <span class="val">216</span> euros')],
  ['escaping', home.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; stays text') && !home.includes('<script>')],
  ['relative links', home.includes('href="care/"') && fs.readFileSync(path.join(OUT, 'static', 'care/index.html'), 'utf8').includes('href="../faq/"')],
  ['button dropped', !home.includes('Press me')],
]) console.log((ok ? 'ok   ' : 'FAIL ') + what);
