// The site model: which pages a site publishes, their titles, parents,
// order and URLs. Page semantics follow the editor's Pages object
// (slop-computer apps/upstream/blocks/src/blocks.js): a page is a top-level branch
// that is not reserved, its parent must exist and must not make a cycle,
// siblings are ordered by an order cell or by the clock of their first
// write.
const { F } = require('./blocks.js');

const RESERVED = new Set(['desk', 'sys', 'clock', 'spaces', 'theme', 'fn', 'lib', 'jobs', 'ws']);
const NAME = /^[A-Za-z_]\w*$/;

// "Getting started!" -> "getting-started"; never empty, never starting with "_".
function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

function build(K, config, source) {
  config = config || {};
  const isPage = (n) => !!n && !RESERVED.has(n) && NAME.test(n) && K.isBranch(n);
  const all = K.children('').filter((s) => !RESERVED.has(s) && !K.cells.has(s) && NAME.test(s));
  const title = (n) => {
    const t = K.cells.get(n + '.title');
    if (t && t.kind === 'lit') return typeof t.v === 'string' && t.v.trim() ? t.v : 'Untitled';
    if (t) { const v = K.valueAt(n + '.title'); return typeof v === 'string' ? v : F.fmt(v); }
    return 'Untitled';
  };
  const icon = (n) => { const t = K.cells.get(n + '.icon'); return t && typeof t.v === 'string' ? t.v : ''; };
  const parentOf = (n) => {
    const c = K.cells.get(n + '.parent'), p = c && typeof c.v === 'string' ? c.v : '';
    if (!p || p === n || !isPage(p)) return '';
    let a = p;
    for (let i = 0; i < 24 && a; i++) { if (a === n) return ''; const cc = K.cells.get(a + '.parent'); a = cc && typeof cc.v === 'string' ? cc.v : ''; }
    return p;
  };
  const born = (n) => {
    let best = Infinity;
    for (const s of ['title', 'ui']) { const c = K.cells.get(n + '.' + s); if (c && c.clock) best = Math.min(best, c.clock); }
    const o = K.cells.get(n + '.order');
    return o && typeof o.v === 'number' ? o.v : best;
  };
  const chainOf = (n) => { const out = []; let a = n; for (let i = 0; i < 24 && a; i++) { out.unshift(a); a = parentOf(a); } return out; };

  const root = isPage(config.root) ? config.root : '';
  const pages = all.filter((p) => !root || chainOf(p).includes(root)).sort((a, b) => born(a) - born(b) || (a < b ? -1 : 1));
  const published = new Set(pages);
  // Within a site, a page whose parent is outside it is a root.
  const parent = (n) => { const p = parentOf(n); return published.has(p) ? p : ''; };
  const kids = (n) => pages.filter((p) => parent(p) === n);
  const roots = pages.filter((p) => !parent(p));
  const chain = (n) => { const out = []; let a = n; for (let i = 0; i < 24 && a; i++) { out.unshift(a); a = parent(a); } return out; };

  const slugs = new Map(), bySlug = new Map();
  for (const p of pages) {
    const s0 = slugify(title(p)) || slugify(p) || 'page';
    let s = s0, i = 2;
    while (bySlug.has(s) || published.has(s) && s !== p) s = s0 + '-' + i++;
    slugs.set(p, s); bySlug.set(s, p);
  }
  const home = published.has(config.home) ? config.home : root || roots[0] || '';
  return {
    source: source || '', config, all, pages, published, home, roots,
    title, icon, parent, kids, chain, K,
    has: (n) => published.has(n),
    slug: (n) => slugs.get(n) || '',
    // a URL segment (slug or page id) -> page id
    find: (seg) => bySlug.get(seg) || (published.has(seg) ? seg : ''),
    name: config.title || (home ? title(home) : 'Blocks'),
  };
}

module.exports = { build, slugify, RESERVED };
