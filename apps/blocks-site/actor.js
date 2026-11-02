// Blocks site (SLOP3-003): a Claude Blocks workspace as web pages. The
// instance is bound to a workspace (alias "source"); the actor folds the
// workspace's ops with the editor's own kernel and serves its pages as
// HTML without script: the live reader. Install (admin, once):
//   slop push apps/blocks-site --store blocks-site
//   slop mount set <live host> /pub/:id --storeParam id --type blocks-site
// A site (any member, for a workspace they administer):
//   slop store new team-site --app blocks-site --type blocks-site
//   slop bind set team-site source ws-team
//   slop grant set ws-team store:team-site view
//   slop grant set team-site @guest view
// Uploaded files (pictures, PDFs) are published only when the binding
// shares them, which needs admin on the workspace as well:
//   slop bind set team-site source ws-team --assets true
// The reader then serves the files its pages show at _media/<id>, and a
// publication copies them to media/<id>.
// Static publishing renders every page into a static store through the
// workshop module, as the person publishing (an admin of that store):
//   slop app trust blocks-site workshop                       (admin, once)
//   slop mount set <static host> /s/:id --storeParam id --type site
//   slop store new team-static --type site
//   slop grant set team-static @guest view
//   slop call team-site publish '{"to":"team-static","live":true}'
// or the forms at <site>/_site.
const { fold } = require('./lib/fold.js');
const site = require('./lib/site.js');
const render = require('./lib/render.js');
const db = use('db');
const stores = use('stores');

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// The last fold, kept between turns: refolded when the workspace's rev
// moves, the site model rebuilt when the settings (or whether uploads are
// shared) change. src is this turn's handle on the workspace.
let cache = null;

function settings() {
  const d = db.doc('site/config').get();
  return (d.exists && d.data()) || {};
}

function current() {
  const src = stores.open('source'), rev = src.rev(), cfg = settings(), key = JSON.stringify(cfg) + (src.assets ? ' +assets' : '');
  if (!cache || cache.source !== src.id || cache.rev !== rev) {
    const r = fold(src);
    cache = { source: src.id, rev, K: r.K, ops: r.ops };
  }
  if (cache.key !== key) { cache.key = key; cache.site = site.build(cache.K, cfg, src.id); cache.media = null; }
  cache.src = src;
  return cache;
}

// The uploads the published pages show: the only ones the reader serves.
function shown(c) {
  if (!c.media) c.media = c.src.assets ? render.mediaOf(c.site) : new Set();
  return c.media;
}

const PAGE = /^[A-Za-z_]\w*$/, STORE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function published() {
  const d = db.doc('site/published').get();
  return d.exists ? d.data() : null;
}

// Settings: a title, a home page, a root page (the site is that page and
// its sub-pages), the static store to publish to. An empty value clears.
function configure(args) {
  const cfg = Object.assign({}, settings());
  const set = (k, v, ok) => { if (v === undefined) return; v = text(v, 120); if (!v) delete cfg[k]; else if (ok(v)) cfg[k] = v; else throw new Error(`invalid ${k}: ${v}`); };
  set('title', args.title, () => true);
  set('home', args.home, (v) => PAGE.test(v));
  set('root', args.root, (v) => PAGE.test(v));
  set('to', args.to, (v) => STORE.test(v));
  db.doc('site/config').set(cfg);
  return cfg;
}

// Render every page and push them into a static store as the visitor
// (files.push needs admin there); live moves its main, otherwise only
// its draft moves, for review in the Workshop.
async function publish(ctx, to, live) {
  const w = use('workshop');
  if (!w) ctx.fail('unavailable', 'this app is not trusted with the workshop module (slop app trust blocks-site workshop)');
  to = text(to || settings().to, 63);
  if (!STORE.test(to)) ctx.fail('invalid_argument', 'publishing needs a static store (to)');
  if (to === ctx.store.id) ctx.fail('invalid_argument', 'a site cannot publish into itself');
  const c = current(), s = c.site;
  if (!s.pages.length) ctx.fail('invalid_argument', 'nothing to publish: the site has no pages');
  const seen = new Set(), files = render.staticFiles(s, { assets: !!c.src.assets, seen });
  // uploads by hash: the server already holds the bytes, nothing is sent again
  for (const id of seen) {
    const a = c.src.assets.get(id);
    if (a) files.push({ path: 'media/' + id, sha256: a.sha256, size: a.size, type: a.type });
  }
  const snap = await w.push(to, files, { message: `${s.pages.length} pages from ${s.source} (rev ${c.rev})` });
  if (live) await w.publish(to, snap.n);
  const rec = { to, n: snap.n, live: !!live, at: Date.now(), by: ctx.visitor.id, pages: s.pages.length, rev: c.rev };
  db.doc('site/published').set(rec);
  return Object.assign({ files: files.length }, rec);
}

// application/x-www-form-urlencoded
function form(body) {
  const out = {};
  for (const kv of String(body || '').split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('='), dec = (x) => { try { return decodeURIComponent(x.replace(/\+/g, ' ')); } catch (e) { return ''; } };
    out[dec(i < 0 ? kv : kv.slice(0, i))] = dec(i < 0 ? '' : kv.slice(i + 1));
  }
  return out;
}

// The note above the forms, from the redirect's query: built from known
// codes and checked values only, never from free text in the URL.
function note(q) {
  const to = STORE.test(q.to || '') ? q.to : '', n = /^\d+$/.test(q.n || '') ? q.n : '';
  if (q.m === 'saved') return { note: 'Settings saved.' };
  if (q.m === 'published' && to && n) return { note: q.live === '1' ? `Published #${n}: ${to} serves it now.` : `Pushed draft #${n} to ${to}. Review it in the Workshop, then publish it there.` };
  const why = { permission_denied: `You need to be an admin of ${to || 'the static store'} to publish into it.`, not_found: `There is no store ${to}.`,
    unavailable: 'Publishing is not set up: an admin runs slop app trust blocks-site workshop.', invalid_argument: 'Name a static store to publish into.' };
  if (q.e) return { note: why[q.e] || `Publishing failed (${q.e.replace(/[^a-z_]/g, '')}).`, bad: true };
  return {};
}

function settingsPage(ctx, req) {
  let c;
  try { c = current(); } catch (e) { return page(503, render.bare('Not available', `This site cannot read its workspace: ${e.message || e}`)); }
  const n = note(req.query || {});
  const html = render.adminPage(c.site, { base: req.base, source: c.site.source, rev: c.rev, published: published(), note: n.note, bad: n.bad, trusted: !!use('workshop'), assets: !!c.src.assets });
  return page(200, html);
}

const isAdmin = (ctx) => ctx.visitor.level === 'admin' || ctx.visitor.level === 'owner';
const page = (status, html) => ({ status, html, headers: { 'Content-Security-Policy': CSP, 'Cache-Control': 'private, no-cache', 'Referrer-Policy': 'same-origin' } });
const redirect = (to, status) => ({ status: status || 302, headers: { Location: to, 'Cache-Control': 'no-store' }, text: '' });

function show(ctx, req, seg) {
  try {
    return showPage(ctx, req, seg);
  } catch (e) {
    console.error(`blocks-site: ${req.path} failed: ${e && e.message ? e.message : e}`);
    return page(500, render.bare('Something went wrong', 'This page could not be shown.'));
  }
}

function showPage(ctx, req, seg) {
  let c;
  try {
    c = current();
  } catch (e) {
    // no binding, or no grant on the workspace: say so to the site's admins only
    return page(503, render.bare('Not available', isAdmin(ctx) ? `This site cannot read its workspace: ${e.message || e}` : 'This site is not available.'));
  }
  const s = c.site, links = render.liveLinks(s, req.base, !!c.src.assets);
  const opts = { link: links.link, home: links.home, media: links.media, admin: isAdmin(ctx) ? { source: s.source, href: req.base + '/_site' } : null };
  if (!seg) return page(200, s.home ? render.page(s, s.home, opts) : render.message(s, s.name, 'Nothing is published here yet.', opts));
  const n = s.find(seg);
  if (!n) return page(404, render.message(s, 'Not found', 'There is no page here.', opts));
  // a page id, or the home page's slug: send it to the page's own address
  if (seg !== (n === s.home ? '' : s.slug(n))) return redirect(links.link(n));
  return page(200, render.page(s, n, opts));
}

defineActor({
  actions: {
    status(ctx) {
      ctx.need('view');
      const c = current(), s = c.site;
      return { source: s.source, rev: c.rev, home: s.home, config: settings(), published: published(), assets: !!c.src.assets,
        pages: s.pages.map((p) => ({ id: p, slug: s.slug(p), title: s.title(p), parent: s.parent(p) })) };
    },
    configure(ctx, args) {
      ctx.need('admin');
      try { return configure(args || {}); } catch (e) { ctx.fail('invalid_argument', e.message); }
    },
    async publish(ctx, args) {
      ctx.need('admin');
      return await publish(ctx, (args || {}).to, !!(args || {}).live);
    },
  },
  http: {
    'GET /_site': { level: 'admin', run: settingsPage },
    'POST /_site': {
      level: 'admin',
      run(ctx, req) {
        try { configure(form(req.body)); } catch (e) { return redirect(req.base + '/_site?e=invalid_argument', 303); }
        return redirect(req.base + '/_site?m=saved', 303);
      },
    },
    'POST /_publish': {
      level: 'admin',
      async run(ctx, req) {
        const f = form(req.body);
        try {
          const r = await publish(ctx, f.to, f.live === '1');
          if (f.to && f.to !== settings().to) configure({ to: f.to });
          return redirect(`${req.base}/_site?m=published&n=${r.n}&live=${r.live ? 1 : 0}&to=${r.to}`, 303);
        } catch (e) {
          return redirect(`${req.base}/_site?e=${encodeURIComponent(e.code || 'error')}&to=${encodeURIComponent(f.to || '')}`, 303);
        }
      },
    },
    'GET /': { level: 'view', run: (ctx, req) => show(ctx, req, '') },
    'GET /:page': { level: 'view', run: (ctx, req) => show(ctx, req, req.params.page) },
    // an uploaded file a published page shows; the server sends the bytes
    'GET /_media/:id': {
      level: 'view',
      run(ctx, req) {
        let c;
        try { c = current(); } catch (e) { return page(503, render.bare('Not available', 'This site is not available.')); }
        if (!shown(c).has(req.params.id)) return page(404, render.bare('Not found', 'There is no file here.'));
        return { asset: { from: 'source', id: req.params.id }, headers: { 'Cache-Control': 'private, no-cache' } };
      },
    },
    // deeper paths are no page either (and never fall through to the shell)
    'GET /*': { level: 'view', run: (ctx, req) => show(ctx, req, '\u0000') },
  },
});
