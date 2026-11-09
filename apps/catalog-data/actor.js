// SLOP3-018: the francois catalog's one copy. The tables (sql/001_catalog.sql)
// hold every listed app; the release importer writes them through the
// admin actions below, and everything that shows the catalog reads them
// here:
//
//   the static views (site host)  GET <api>/catalog.json, across origins (CORS)
//   Shelf and Curator pages       GET /catalog/api/catalog.json, same host
//   the Curator's actor           use('stores').open('catalog').call('catalog')
//   agents                        POST / (MCP), /apps, /llms.txt, /search-index.json, /feed.xml
//
// Writes (admin): upsertApp(item), removeApp({id}), importCatalog({items, prune, …}),
// configure({source, appsOrigin, siteOrigin, api, mcp}). Each bumps the
// catalog's rev, which the routes send as their ETag.
//
// Search matches every word of a query in an app's title, description, id
// and tags (as the views and the old MCP server did), with instr() on a
// lower-case column: this server's SQLite has no FTS5, and 100 apps need none.
const sql = use('sql');
const app = require('express').app();
const C = require('./catalog.js');
const mcp = require('./mcp.js');

const META = ['source', 'appsOrigin', 'siteOrigin', 'api', 'mcp'];

// --- reads -------------------------------------------------------------------

function meta() {
  const m = {};
  for (const r of sql.all('SELECT key, value FROM catalog_meta')) m[r.key] = r.value;
  return m;
}

function rev() {
  const r = sql.one("SELECT value FROM catalog_meta WHERE key = 'rev'");
  return r ? Number(r.value) : 0;
}

// withReleases turns apps rows into items, each with its releases (newest
// first; one made from the item's own version when it has none).
function withReleases(rows) {
  if (!rows.length) return [];
  const byApp = {};
  const rels = rows.length === 1
    ? sql.all('SELECT app, version, published_at, changelog FROM releases WHERE app = ? ORDER BY published_at DESC, version DESC', rows[0].id)
    : sql.all('SELECT app, version, published_at, changelog FROM releases ORDER BY published_at DESC, version DESC');
  for (const r of rels) (byApp[r.app] = byApp[r.app] || []).push({ version: r.version, publishedAt: r.published_at, changelog: r.changelog });
  return rows.map((r) => {
    const i = JSON.parse(r.facts);
    i.releases = byApp[r.id] || [{ version: i.version, publishedAt: i.publishedAt, changelog: '' }];
    return i;
  });
}

const ORDER = {
  new: "COALESCE(a.published_at, '') DESC, a.id DESC", // catalog.json's order
  old: "COALESCE(a.published_at, '') ASC, a.id ASC",
  title: 'lower(a.title) ASC, a.id ASC',
  size: 'a.bytes DESC, a.id ASC',
};

// find: the items matching a search, in an order. Every filter is optional.
function find(f) {
  const where = [], args = [];
  for (const w of f.words || []) { where.push('instr(a.search, ?) > 0'); args.push(w); }
  if (f.tag) { where.push('EXISTS (SELECT 1 FROM app_tags t WHERE t.app = a.id AND t.tag = ?)'); args.push(String(f.tag)); }
  if (f.cap) { where.push('EXISTS (SELECT 1 FROM app_caps c WHERE c.app = a.id AND c.cap = ?)'); args.push(String(f.cap)); }
  if (f.free === true || f.free === false) { where.push('a.free = ?'); args.push(f.free ? 1 : 0); }
  if (f.id) { where.push('a.id = ?'); args.push(String(f.id)); }
  const q = 'SELECT a.id, a.facts FROM apps a' + (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY ' + (ORDER[f.sort] || ORDER.new);
  return withReleases(sql.all(q, ...args));
}

// catalog: catalog.json as SLOP3-015's build wrote it, from the tables.
function catalog() {
  const m = meta();
  const items = find({});
  const n = {};
  for (const i of items) for (const t of i.tags) n[t] = (n[t] || 0) + 1;
  return {
    generated: m.updated || null,
    source: m.source || null,
    appsOrigin: m.appsOrigin || null,
    mcp: m.mcp || null,
    siteOrigin: m.siteOrigin || null,
    api: m.api || null,
    rev: Number(m.rev || 0),
    count: items.length,
    totalBytes: items.reduce((s, i) => s + (i.bytes || 0), 0),
    tags: Object.keys(n).sort((a, b) => n[b] - n[a] || (a < b ? -1 : a > b ? 1 : 0)).map((t) => ({ tag: t, count: n[t] })),
    items,
  };
}

function item(id) {
  return find({ id })[0] || null;
}

const lib = { catalog, item, search: find };

// --- writes ------------------------------------------------------------------

function iso(ms) {
  return new Date(ms).toISOString().slice(0, 19) + 'Z';
}

function bump(ctx) {
  sql.run("UPDATE catalog_meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'rev'");
  sql.run("UPDATE catalog_meta SET value = ? WHERE key = 'updated'", iso(ctx.now));
  return rev();
}

// put writes one normalized item: its row (an upsert, so the releases,
// tags and capabilities that reference it are not cascaded away), its tags
// and capabilities, and its releases: all of them when the item lists
// them, else its own version added to those already known.
function put(ctx, i) {
  const facts = Object.assign({}, i);
  delete facts.releases;
  sql.run(`INSERT INTO apps (id, title, description, version, published_at, bytes, free, featured, search, facts, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, version = excluded.version,
             published_at = excluded.published_at, bytes = excluded.bytes, free = excluded.free, featured = excluded.featured,
             search = excluded.search, facts = excluded.facts, updated_at = excluded.updated_at`,
  i.id, i.title, i.description, i.version, i.publishedAt, i.bytes, i.free ? 1 : 0, i.featured ? 1 : 0,
  C.haystack(i), JSON.stringify(facts), ctx.now);
  sql.run('DELETE FROM app_tags WHERE app = ?', i.id);
  for (const t of new Set(i.tags)) sql.run('INSERT INTO app_tags (app, tag) VALUES (?, ?)', i.id, t);
  sql.run('DELETE FROM app_caps WHERE app = ?', i.id);
  for (const c of new Set(i.capabilities)) sql.run('INSERT INTO app_caps (app, cap) VALUES (?, ?)', i.id, c);
  if (i.releases) {
    sql.run('DELETE FROM releases WHERE app = ?', i.id);
    for (const r of i.releases) {
      sql.run('INSERT OR REPLACE INTO releases (app, version, published_at, changelog) VALUES (?, ?, ?, ?)', i.id, r.version, r.publishedAt, r.changelog);
    }
  } else if (i.version) {
    sql.run(`INSERT INTO releases (app, version, published_at, changelog) VALUES (?, ?, ?, '')
             ON CONFLICT(app, version) DO UPDATE SET published_at = excluded.published_at`, i.id, i.version, i.publishedAt);
  }
}

function remove(id) {
  // app_tags, app_caps and releases go with the row (ON DELETE CASCADE).
  return sql.run('DELETE FROM apps WHERE id = ?', id).changes > 0;
}

function setMeta(args) {
  for (const k of META) {
    if (args[k] === undefined) continue;
    const v = args[k] === null ? '' : String(args[k]);
    if (v && !/^https:\/\/[^\s"'<>\\]+$/.test(v)) C.bad(k + ' is an https URL');
    sql.run('INSERT INTO catalog_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v.replace(/\/+$/, ''));
  }
}

// guard runs a write and turns a validation error into ctx.fail.
function guard(ctx, fn) {
  try {
    return fn();
  } catch (e) {
    if (e && e.code === 'invalid_argument') ctx.fail('invalid_argument', e.message);
    throw e;
  }
}

// catalog.json's derived fields, which importCatalog accepts and ignores, so
// a file the old build wrote can be sent as it is.
const DERIVED = ['generated', 'count', 'totalBytes', 'tags', 'rev'];

const actions = {
    upsertApp: {
      requires: 'admin',
      run(ctx, args) {
        return guard(ctx, () => {
          const i = C.normalize(args);
          const known = !!sql.one('SELECT 1 AS x FROM apps WHERE id = ?', i.id);
          put(ctx, i);
          return { id: i.id, created: !known, rev: bump(ctx) };
        });
      },
    },
    removeApp: {
      requires: 'admin',
      run(ctx, args) {
        const id = args && args.id;
        if (typeof id !== 'string' || !id) ctx.fail('invalid_argument', 'removeApp takes {id}');
        const removed = remove(id);
        return { id, removed, rev: removed ? bump(ctx) : rev() };
      },
    },
    importCatalog: {
      requires: 'admin',
      run(ctx, args) {
        return guard(ctx, () => {
          if (!args || typeof args !== 'object' || !Array.isArray(args.items)) C.bad('importCatalog takes {items: [...], prune, source, appsOrigin, siteOrigin, api, mcp}');
          for (const k of Object.keys(args)) {
            if (k !== 'items' && k !== 'prune' && !META.includes(k) && !DERIVED.includes(k)) C.bad('unknown field ' + k);
          }
          // Check every item before writing any.
          const items = args.items.map((x, n) => {
            try { return C.normalize(x); } catch (e) { C.bad('items[' + n + ']: ' + e.message); }
          });
          const ids = new Set();
          for (const i of items) {
            if (ids.has(i.id)) C.bad('items: ' + i.id + ' is listed twice');
            ids.add(i.id);
          }
          setMeta(args);
          const before = new Set(sql.all('SELECT id FROM apps').map((r) => r.id));
          for (const i of items) put(ctx, i);
          const removed = [];
          if (args.prune === true) {
            for (const id of before) if (!ids.has(id) && remove(id)) removed.push(id);
          }
          return { upserted: items.length, created: items.filter((i) => !before.has(i.id)).length, removed, rev: bump(ctx) };
        });
      },
    },
    configure: {
      requires: 'admin',
      run(ctx, args) {
        return guard(ctx, () => {
          if (!args || typeof args !== 'object') C.bad('configure takes {source, appsOrigin, siteOrigin, api, mcp}');
          for (const k of Object.keys(args)) if (!META.includes(k)) C.bad('unknown field ' + k);
          setMeta(args);
          bump(ctx);
          const m = meta();
          return Object.fromEntries(META.map((k) => [k, m[k] || null]));
        });
      },
    },
    // Reads, for actors bound to this store (the Curator) and the CLI.
    catalog: { requires: 'view', run: () => catalog() },
    app: {
      requires: 'view',
      run(ctx, args) {
        const i = args && typeof args.id === 'string' ? item(args.id) : null;
        if (!i) ctx.fail('not_found', 'no app ' + JSON.stringify(args && args.id));
        return i;
      },
    },
};

// --- routes --------------------------------------------------------------------
//
// All public. The mounts add the rest: /catalog/api (every route, CORS for
// the site host, a per-IP rate limit, if-none-match forwarded) and
// /catalog/mcp (POST / and GET / only).

// fresh answers 304 when the browser has this rev, and otherwise sends.
// A response is the same for one URL and one rev, so the rev is its ETag.
function fresh(ctx, res, send) {
  const tag = '"c' + rev() + '"';
  res.set('ETag', tag).set('Cache-Control', 'public, no-cache');
  const have = String(ctx.request.headers['if-none-match'] || '').split(',').map((s) => s.trim().replace(/^W\//, ''));
  if (have.includes(tag)) return res.status(304).end();
  return send();
}

app.get('/catalog.json').public().handle((ctx, res) => fresh(ctx, res, () => res.json(catalog())));

const truthy = (v) => (v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : undefined);

app.get('/apps').public().handle((ctx, res) => fresh(ctx, res, () => {
  const q = ctx.query || {};
  const limit = Math.max(1, Math.min(200, parseInt(q.limit, 10) || 50));
  const offset = Math.max(0, parseInt(q.offset, 10) || 0);
  const all = find({ words: C.words(q.q), tag: q.tag, cap: q.cap, free: truthy(q.free), sort: q.sort });
  res.json({ total: all.length, offset, limit, items: all.slice(offset, offset + limit) });
}));

app.get('/apps/:id').public().handle((ctx, res) => {
  const i = item(ctx.params.id);
  if (!i) return res.status(404).json({ error: { code: 'not_found', message: 'no app ' + JSON.stringify(ctx.params.id) } });
  return fresh(ctx, res, () => res.json(i));
});

app.get('/feed.xml').public().handle((ctx, res) => fresh(ctx, res, () => res.type('application/atom+xml; charset=utf-8').send(C.atom(catalog()))));
app.get('/llms.txt').public().handle((ctx, res) => fresh(ctx, res, () => res.type('text/plain; charset=utf-8').send(C.llmsTxt(catalog()))));
app.get('/search-index.json').public().handle((ctx, res) => fresh(ctx, res, () => res.json(C.searchIndex(catalog()))));

app.post('/').public().handle((ctx, res) => {
  const body = ctx.body;
  if (body === null || body === undefined || typeof body !== 'object') {
    return res.status(400).json(mcp.err(null, -32700, 'send a JSON-RPC message as application/json'));
  }
  const out = Array.isArray(body) ? body.map((m) => mcp.answer(m, lib)).filter(Boolean) : mcp.answer(body, lib);
  if (out === null || (Array.isArray(out) && !out.length)) return res.status(202).end();
  res.set('Cache-Control', 'no-store').json(out);
});

// A GET of / is a person or a probe: say what this is (MCP has no SSE
// stream here, hence 405), and where the rest of the catalog is.
app.get('/').public().handle((ctx, res) => {
  const m = meta();
  res.status(405).set('Allow', 'POST').json({
    name: 'slop catalog MCP', transport: 'streamable-http (JSON responses, stateless)',
    usage: 'POST JSON-RPC 2.0 messages here; see /catalog/agents/', tools: mcp.TOOLS,
    api: m.api ? { catalog: m.api + '/catalog.json', apps: m.api + '/apps?q=', app: m.api + '/apps/{id}',
      feed: m.api + '/feed.xml', llms: m.api + '/llms.txt', searchIndex: m.api + '/search-index.json' } : null,
  });
});

defineActor({ actions });
