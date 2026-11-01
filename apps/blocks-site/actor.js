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
const { fold } = require('./lib/fold.js');
const site = require('./lib/site.js');
const render = require('./lib/render.js');
const db = use('db');
const stores = use('stores');

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// The last fold, kept between turns: refolded when the workspace's rev
// moves, the site model rebuilt when the settings change.
let cache = null;

function settings() {
  const d = db.doc('site/config').get();
  return (d.exists && d.data()) || {};
}

function current() {
  const src = stores.open('source'), rev = src.rev(), cfg = settings(), key = JSON.stringify(cfg);
  if (!cache || cache.source !== src.id || cache.rev !== rev) {
    const r = fold(src);
    cache = { source: src.id, rev, K: r.K, ops: r.ops };
  }
  if (cache.key !== key) { cache.key = key; cache.site = site.build(cache.K, cfg, src.id); }
  return cache;
}

const isAdmin = (ctx) => ctx.visitor.level === 'admin' || ctx.visitor.level === 'owner';
const page = (status, html) => ({ status, html, headers: { 'Content-Security-Policy': CSP, 'Cache-Control': 'private, no-cache', 'Referrer-Policy': 'same-origin' } });
const redirect = (to, status) => ({ status: status || 302, headers: { Location: to, 'Cache-Control': 'no-store' }, text: '' });

function show(ctx, req, seg) {
  let c;
  try {
    c = current();
  } catch (e) {
    // no binding, or no grant on the workspace: say so to the site's admins only
    return page(503, render.bare('Not available', isAdmin(ctx) ? `This site cannot read its workspace: ${e.message || e}` : 'This site is not available.'));
  }
  const s = c.site, links = render.liveLinks(s, req.base);
  const opts = { link: links.link, home: links.home, admin: isAdmin(ctx) ? { source: s.source, href: req.base + '/_site' } : null };
  if (!seg) return page(200, s.home ? render.page(s, s.home, opts) : render.message(s, s.name, 'Nothing is published here yet.', opts));
  const n = s.find(seg);
  if (!n) return page(404, render.message(s, 'Not found', 'There is no page here.', opts));
  // a page id, or the home page's slug: send it to the page's own address
  if (seg !== (n === s.home ? '' : s.slug(n))) return redirect(links.link(n));
  return page(200, render.page(s, n, opts));
}

defineActor({
  http: {
    'GET /': { level: 'view', run: (ctx, req) => show(ctx, req, '') },
    'GET /:page': { level: 'view', run: (ctx, req) => show(ctx, req, req.params.page) },
    // deeper paths are no page either (and never fall through to the shell)
    'GET /*': { level: 'view', run: (ctx, req) => show(ctx, req, '\u0000') },
  },
});
