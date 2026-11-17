// The bench's server half (SLOP3-022, SLOP3-023). A project is an app store:
// its files are the app's snapshots, read at numbers and changed by commits
// (files.commit: a change list against a base snapshot, merged per file).
// The page shows the app through instances, stores that run the app at a
// ref, one of each kind per person: dev (draft), test (draft, seeded with a
// fixture for scenarios) and prop (the proposal under review). What the
// bench adds around an app (the canvas, threads, the timeline, layout
// snapshots, proposals) is in this store's SQL (sql/001_bench.sql), per
// person. Every call into an app store goes through the workshop module as
// the visiting person: the bench can do nothing they could not do with the
// CLI. Install:
//   slop push apps/bench --store bench
//   slop app trust bench workshop
//   slop mount set <live host> /bench bench
const ws = use('workshop');
const sql = use('sql');

// A store id (pkg/registry/stores.go).
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
// The refs the bench commits to: draft, and one per proposal.
const PROPOSAL = /^proposal\/[a-z0-9][a-z0-9-]{0,40}$/;
// How many bytes of file text one read answers with; the page asks again
// for the rest.
const READ_BUDGET = 4 << 20;
// Instances: what each kind follows (prop: its proposal; there is one per
// proposal, see instanceOf).
const KINDS = { dev: 'draft', test: 'draft', prop: '' };

function tool(ctx) {
  if (!ws) ctx.fail('unavailable', 'the bench is not trusted with the workshop module (slop app trust <store> workshop)');
  return ws;
}
// text is v cut to max characters ('' for none). The schemas have checked
// that v is a string; free text (titles, notes) is shortened, not refused.
function text(v, max) { return String(v == null ? '' : v).slice(0, max); }

// The actions' argument schemas (SLOP3-024 phase 2): the server checks them
// before run, so a wrong shape is invalid_argument naming its place, and run
// converts nothing. Extra properties are allowed: the page may send more
// than an action reads.
const S = {
  store: { type: 'string', pattern: ID.source, description: 'a store id: lowercase letters, digits and -' },
  // A snapshot number (0: none, for a ref that does not exist yet).
  n: { type: 'integer', minimum: 0 },
  ref: { anyOf: [{ const: 'draft' }, { type: 'string', pattern: PROPOSAL.source }], description: 'draft or proposal/<id>' },
  proposal: { type: 'string', pattern: PROPOSAL.source },
  kind: { enum: Object.keys(KINDS) },
  id: { type: 'string', pattern: '^[\\w-]{1,80}$' },
  str: { type: 'string' },
  // Free text that may be absent as null too (a thread, a note).
  text: { type: ['string', 'null'] },
  obj: { type: 'object' },
  rows: { type: 'object', additionalProperties: { type: 'array', items: { type: 'object' } } },
  // A change as files.commit takes it; the server checks it is exactly one kind.
  changes: {
    type: 'array', minItems: 1,
    items: {
      type: 'object', required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1 }, text: { type: 'string' }, data: { type: 'string' },
        sha256: { type: 'string' }, size: { type: 'integer', minimum: 0 }, type: { type: 'string' }, delete: { const: true },
      },
    },
  },
};
// args is an object schema: the properties, the required ones listed.
function args(properties, required) { return { type: 'object', required: required || [], properties }; }
// An instance's arguments: the app, the kind, and a proposal's ref for prop.
const INSTANCE = args({ app: S.store, kind: S.kind, ref: S.ref }, ['app', 'kind']);
function json(v) { try { return JSON.parse(v); } catch (e) { return null; } }

// The changes of a commit as files.commit takes them: {path, text} |
// {path, data} | {path, sha256, size, type?} | {path, delete: true}. Their
// fields pass through as given; the server checks that each change is
// exactly one of these (and that a sha256 names a blob it has). Nothing is
// coerced here: a change the page got wrong fails, it does not become
// something else.
const CHANGE_FIELDS = ['text', 'data', 'sha256', 'size', 'type', 'delete'];
function changeList(ctx, changes, { deletes = true } = {}) {
  return changes.map((c) => {
    if (!deletes && c.delete) ctx.fail('invalid_argument', c.path + ': a new app has nothing to delete');
    const out = { path: c.path };
    for (const k of CHANGE_FIELDS) if (c[k] !== undefined) out[k] = c[k];
    return out;
  });
}

// A person's instance of an app: <app>-<kind>-<the first six characters of
// their id> (dev is the same name as `slop dev`, pkg/client/dev.go).
function instanceId(app, person, kind) {
  const tail = '-' + kind + '-' + String(person || '').replace(/^usr_/, '').toLowerCase().slice(0, 6);
  return app.slice(0, 63 - tail.length) + tail;
}

// The store id of the visitor's instance of a kind. dev and test are one
// each per app; prop is one per proposal (<app>-prop-<proposal id>-<person>),
// so proposals shown side by side each run their own code on their own data.
function instanceOf(ctx, app, kind, ref) {
  if (kind !== 'prop') return instanceId(app, ctx.visitor.id, kind);
  if (!PROPOSAL.test(ref || '')) ctx.fail('invalid_argument', 'a prop instance is a proposal\'s: pass its ref');
  return instanceId(app, ctx.visitor.id, 'prop-' + ref.slice('proposal/'.length));
}

async function allStores(ctx) {
  return await tool(ctx).stores({ all: ctx.visitor.audience === 'admin' });
}

// A store that does not exist, or that the visitor cannot read, has no
// status; neither case is an error here. With {peek: true} it only looks
// ({n: running now, next: the version it activates on its next use});
// without, asking activates a newer version the store follows; with
// {migrations: true} the answer has applied: {sql/… name: sha256}.
async function statusOf(ctx, id, opts) {
  try { return await tool(ctx).status(id, opts || {}); } catch (e) { return null; }
}

// A listing as the page keeps it.
function listing(files) {
  return files.map((f) => ({ path: f.path, sha256: f.sha256, size: f.size, type: f.type || '' }));
}

// The visitor's timeline: events are numbered per app and person. Every
// event is on a ref and records that ref's snapshot (n) when it happened:
// what restoring to it, or a diff since it, starts from.
function isSnap(n) { return Number.isInteger(n) && n > 0; }
function addEvent(ctx, app, e) {
  if (typeof e.ref !== 'string' || !e.ref || !isSnap(e.n)) throw new Error('an event needs its ref and that ref\'s snapshot (' + e.kind + ' on ' + e.ref + ' at ' + e.n + ')');
  const row = sql.one('SELECT coalesce(max(seq), 0) + 1 AS seq FROM events WHERE app = ? AND owner = ?', app, ctx.visitor.id);
  const at = Date.now();
  const data = Object.assign({}, e.data || {});
  sql.run('INSERT INTO events (app, owner, seq, at, who, kind, thread, ref, n, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    app, ctx.visitor.id, row.seq, at, text(e.who || 'you', 20), text(e.kind, 30), e.thread ? text(e.thread, 80) : null,
    text(e.ref, 80), e.n, JSON.stringify(data));
  return eventOut({ seq: row.seq, at, who: e.who || 'you', kind: e.kind, thread: e.thread || null, ref: e.ref, n: e.n, data: JSON.stringify(data) });
}
function eventOut(r) {
  return Object.assign(json(r.data) || {}, { seq: r.seq, at: r.at, who: r.who, kind: r.kind, thread: r.thread || null, ref: r.ref, n: r.n });
}
function ownThread(ctx, id) {
  const t = sql.one('SELECT id, app, owner FROM threads WHERE id = ?', text(id, 80));
  if (t && t.owner !== ctx.visitor.id) ctx.fail('permission_denied', 'that thread is someone else\'s');
  return t;
}

// The stores following a ref of an app among the visitor's instances
// (peeked, so nothing activates by being asked).
async function followers(ctx, app, ref) {
  const out = [];
  const ids = ['dev', 'test'].map((kind) => instanceId(app, ctx.visitor.id, kind));
  if (PROPOSAL.test(ref)) ids.push(instanceOf(ctx, app, 'prop', ref));
  for (const id of ids) {
    const st = await statusOf(ctx, id, { peek: true });
    if (st && st.app === app && st.ref === ref) out.push(id);
  }
  return out;
}

defineActor({
  actions: {
    // ---- apps ----

    // The app stores the visitor may develop (admin on them): stores that
    // run no other store's app, with their refs and the instances that run
    // them. The bench itself is left out.
    // Who the visitor is to the bench: only admins change app code (the
    // platform's decision D9), so the page says so before a member tries.
    me: {
      requires: 'view',
      args: args({}),
      run(ctx) {
        return { audience: ctx.visitor.audience || '', canBuild: ctx.visitor.audience === 'admin' };
      },
    },
    apps: {
      requires: 'view',
      args: args({}),
      async run(ctx) {
        const w = tool(ctx);
        const all = await allStores(ctx);
        const inst = {};
        for (const s of all) if (s.app) (inst[s.app] = inst[s.app] || []).push(s.id);
        const mine = all.filter((s) => !s.app && s.id !== ctx.store.id && (s.level === 'admin' || s.level === 'owner'));
        const refs = await Promise.all(mine.map((s) => w.refs(s.id).catch(() => ({}))));
        return mine.map((s, i) => ({ id: s.id, type: s.type || '', refs: refs[i], instances: inst[s.id] || [] }));
      },
    },

    // Open an app for editing: its refs (draft made from main the first
    // time) and the stores that run it.
    open: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        const w = tool(ctx);
        let refs = await w.refs(app);
        if (refs.draft == null && refs.main != null) {
          try { await w.moveRef(app, 'draft', refs.main, { ifAt: 0 }); } catch (e) { if (e.code !== 'conflict') throw e; } // someone else made it
          refs = await w.refs(app);
        }
        const instances = (await allStores(ctx)).filter((s) => s.app === app).map((s) => s.id);
        const mine = {};
        for (const kind of Object.keys(KINDS)) mine[kind] = instanceId(app, ctx.visitor.id, kind);
        return { app, refs, instances, mine };
      },
    },

    // A new app store, its first files committed to draft (main does not
    // exist until the first publish). The first snapshot is the first
    // event of the creator's timeline, so every later state can be traced
    // back to it.
    create: {
      requires: 'view',
      args: args({ id: S.store, type: S.str, files: S.changes }, ['id', 'files']),
      async run(ctx, { id, type, files }) {
        const w = tool(ctx);
        const list = changeList(ctx, files, { deletes: false });
        await w.newStore(id, type ? { type: text(type, 63) } : {});
        const r = await w.commit(id, list, { ref: 'draft', base: 0, message: 'created in the bench' });
        addEvent(ctx, id, { kind: 'commit', who: 'you', ref: 'draft', n: r.n, data: { paths: list.map((c) => c.path).sort(), base: 0, at: r.at, merged: false, note: 'created in the bench' } });
        return { app: id, n: r.n };
      },
    },

    // ---- files: read at snapshot numbers, changed by commits ----

    // Where a ref points: {n} (0: it does not exist).
    head: {
      requires: 'view',
      args: args({ app: S.store, ref: S.ref }, ['app', 'ref']),
      async run(ctx, { app, ref }) {
        const refs = await tool(ctx).refs(app);
        return { n: refs[ref] ?? 0 };
      },
    },
    // The listing of snapshot n: [{path, sha256, size, type}].
    files: {
      requires: 'view',
      args: args({ app: S.store, at: S.n }, ['app', 'at']),
      async run(ctx, { app, at }) {
        return listing(await tool(ctx).files(app, String(at)));
      },
    },
    // File texts at snapshot n: {texts: {path: text}, binary: [path], more:
    // [path]} (more: what did not fit in this answer).
    read: {
      requires: 'view',
      args: args({ app: S.store, at: S.n, paths: { type: 'array', items: S.str } }, ['app', 'at']),
      async run(ctx, { app, at, paths }) {
        const w = tool(ctx);
        const n = String(at);
        const texts = {}, binary = [], more = [];
        let used = 0;
        for (const path of paths || []) {
          if (used > READ_BUDGET) { more.push(path); continue; }
          const v = await w.read(app, n, path);
          if (typeof v === 'string') { texts[path] = v; used += v.length; } else binary.push(path);
        }
        return { texts, binary, more };
      },
    },
    // Commit changes (changeList's kinds) to a ref over snapshot base. The server merges them over what was committed since,
    // file by file; when someone else changed one of these paths to
    // something else, nothing is written and the answer is {conflict: {at,
    // paths}}. Otherwise the visitor's instances that follow the ref come up
    // on the new snapshot, the commit goes on the timeline (event: {who,
    // thread, note}), and the answer is {n, at, merged, files (n's listing),
    // activated, event}.
    commit: {
      requires: 'view',
      args: args({ app: S.store, ref: S.ref, base: S.n, changes: S.changes, message: S.text, event: args({ who: S.text, thread: S.text, note: S.text }) }, ['app', 'ref', 'base', 'changes']),
      async run(ctx, { app, ref, base, changes, message, event }) {
        const w = tool(ctx);
        const list = changeList(ctx, changes);
        let r;
        try {
          r = await w.commit(app, list, { ref, base, message: text(message || 'bench', 200), activate: await followers(ctx, app, ref) });
        } catch (e) {
          if (e && e.code === 'conflict' && e.extra) return { conflict: { at: e.extra.at, paths: (e.extra.conflicts || []).map((c) => c.path) } };
          throw e;
        }
        const ev = event || {};
        const paths = list.map((c) => c.path).sort();
        const logged = addEvent(ctx, app, { kind: 'commit', who: ev.who, thread: ev.thread, ref, n: r.n, data: { paths, base, at: r.at, merged: !!r.merged, note: text(ev.note || message, 300) } });
        return { n: r.n, at: r.at, merged: !!r.merged, files: listing(await w.files(app, String(r.n))), activated: r.activated || [], event: logged };
      },
    },

    // The app's TypeScript declarations (app.types: page.d.ts, actor.d.ts,
    // modules.d.ts, actions.d.ts), for the page's type checker (SLOP3-024
    // phase 3). The actions are those of the instance that runs the ref
    // being checked: the visitor's dev instance for draft, the proposal's
    // own instance for a proposal (its actor may have other actions than
    // draft's), falling back to the dev instance, then the app store's.
    types: {
      requires: 'view',
      args: args({ app: S.store, ref: S.ref }, ['app']),
      async run(ctx, { app, ref }) {
        const ids = [instanceId(app, ctx.visitor.id, 'dev')];
        if (ref && ref !== 'draft') ids.unshift(instanceOf(ctx, app, 'prop', ref));
        let instance = '';
        for (const id of ids) {
          const st = await statusOf(ctx, id, { peek: true });
          if (st && st.app === app) { instance = id; break; }
        }
        const r = await tool(ctx).types(app, instance ? { instance } : {});
        return { n: r.n, instance: r.instance, files: r.files };
      },
    },

    // Where the app is on the web: the URLs of the mounts that serve its
    // store (a person who publishes asks "what is my link?"). An app no
    // mount serves has none: an administrator gives it an address.
    addresses: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        const ms = await tool(ctx).mounts().catch(() => []);
        return {
          urls: ms.filter((m) => m.mount && (m.mount.store === app || m.mount.store === ':' + app)).map((m) => ({ url: m.url, kind: m.kind })),
        };
      },
    },

    // ---- instances: the visitor's dev, test and prop stores of an app ----

    // Where the app's refs are and what the visitor's instances run (peeked:
    // nothing activates by being asked): {refs, dev, test, props}, each
    // instance {id, ref, n, next, broken}; dev and test are null when they
    // do not exist, props lists the open proposals' instances that do.
    status: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        const out = { refs: await tool(ctx).refs(app), props: [] };
        const peek = async (id) => {
          const st = await statusOf(ctx, id, { peek: true });
          return st && st.app === app ? { id, ref: st.ref || '', n: st.n || 0, next: st.next || 0, broken: st.broken || '' } : null;
        };
        for (const kind of ['dev', 'test']) out[kind] = await peek(instanceId(app, ctx.visitor.id, kind));
        for (const p of sql.all('SELECT ref FROM proposals WHERE app = ? AND owner = ? AND status = ? ORDER BY created', app, ctx.visitor.id, 'open')) {
          const st = await peek(instanceOf(ctx, app, 'prop', p.ref));
          if (st) out.props.push(st);
        }
        return out;
      },
    },
    // The visitor's instance of a kind, made the first time: a store that
    // runs the app at a ref (dev: draft; test: draft or the proposal given;
    // prop: the proposal given, one instance per proposal), with its own
    // data, typed as the app's manifest says so the app's typed mounts
    // serve it. Asking brings it up on its ref.
    instance: {
      requires: 'view',
      args: INSTANCE,
      async run(ctx, { app, kind, ref }) {
        const w = tool(ctx);
        // dev follows draft; test follows draft or the proposal given; prop a proposal
        const follow = kind === 'dev' ? 'draft' : ref || KINDS[kind];
        if (!follow || !(follow === 'draft' || PROPOSAL.test(follow))) ctx.fail('invalid_argument', 'a prop instance follows a proposal ref: pass ref');
        const id = instanceOf(ctx, app, kind, follow);
        let status = await statusOf(ctx, id);
        if (!status) {
          const refs = await w.refs(app);
          let type = '';
          if (refs.draft != null) { try { type = JSON.parse(await w.read(app, String(refs.draft), 'app.json')).type || ''; } catch (e) { /* no manifest, or not JSON: no type */ } }
          await w.newStore(id, type ? { app, type: String(type) } : { app });
          await w.follow(id, follow);
          status = await statusOf(ctx, id);
        } else if (status.app !== app) {
          ctx.fail('conflict', id + ' runs ' + status.app + ', not ' + app);
        } else if (status.ref !== follow) {
          await w.follow(id, follow);
          status = await statusOf(ctx, id);
        }
        return { id, kind, ref: follow, n: status.n || 0, broken: status.broken || '' };
      },
    },
    // Change rows of an instance's data (it runs unpublished code: the
    // server refuses an app store or a production instance): a person
    // removing one test row, which before only a reset of everything could.
    exec: {
      requires: 'view',
      args: args({ ...INSTANCE.properties, query: { type: 'string', maxLength: 20000 }, args: { type: 'array', maxItems: 100 } }, [...INSTANCE.required, 'query']),
      async run(ctx, { app, kind, ref, query, args: a }) {
        return await tool(ctx).exec(instanceOf(ctx, app, kind, ref), query, a || []);
      },
    },
    // Throw an instance and its data away (it runs unpublished code, so
    // workshop's drop allows it); the next use makes a fresh one.
    reset: {
      requires: 'view',
      args: INSTANCE,
      async run(ctx, { app, kind, ref }) {
        const id = instanceOf(ctx, app, kind, ref);
        if ((await statusOf(ctx, id, { peek: true })) !== null) await tool(ctx).drop(id);
        return { dropped: id };
      },
    },
    // A view of an instance framed by the bench's page, with the dev probe:
    // {src, view, secret, version, expiresAt, origin, …}. The page answers
    // the framed runtime's hello with the view and secret, and its renew
    // through renew below.
    embed: {
      requires: 'view',
      args: INSTANCE,
      async run(ctx, { app, kind, ref }) {
        return await tool(ctx).embed(instanceOf(ctx, app, kind, ref), { dev: true });
      },
    },
    renew: {
      requires: 'view',
      args: args({ view: S.str }, ['view']),
      async run(ctx, { view }) {
        return await tool(ctx).renewEmbed(view);
      },
    },
    close: {
      requires: 'view',
      args: args({ view: S.str }, ['view']),
      async run(ctx, { view }) {
        return await tool(ctx).closeEmbed(view);
      },
    },
    // An instance's log (its actor's console, setup and activation
    // failures): {broken, lines: [{at, level, text}]}.
    logs: {
      requires: 'view',
      args: INSTANCE,
      async run(ctx, { app, kind, ref }) {
        return await tool(ctx).logs(instanceOf(ctx, app, kind, ref)).catch(() => ({ broken: '', lines: [] }));
      },
    },
    // An instance's data: its documents, its SQL (read-only), and seeding it
    // ({docs: {coll: [rows]}, tables: {name: [rows]}}). These reach the
    // visitor's own instances only, never a production one.
    docs: {
      requires: 'view',
      args: args({ ...INSTANCE.properties, coll: S.str }, [...INSTANCE.required, 'coll']),
      async run(ctx, { app, kind, ref, coll }) {
        return await tool(ctx).docs(instanceOf(ctx, app, kind, ref), coll);
      },
    },
    doc: {
      requires: 'view',
      args: args({ ...INSTANCE.properties, path: S.str }, [...INSTANCE.required, 'path']),
      async run(ctx, { app, kind, ref, path }) {
        return await tool(ctx).doc(instanceOf(ctx, app, kind, ref), path);
      },
    },
    sql: {
      requires: 'view',
      args: args({ ...INSTANCE.properties, query: S.str, args: { type: 'array' } }, [...INSTANCE.required, 'query']),
      async run(ctx, { app, kind, ref, query, args }) {
        return await tool(ctx).sql(instanceOf(ctx, app, kind, ref), query, args || []);
      },
    },
    seed: {
      requires: 'view',
      args: args({ ...INSTANCE.properties, docs: S.rows, tables: S.rows }, INSTANCE.required),
      async run(ctx, { app, kind, ref, docs, tables }) {
        const w = tool(ctx);
        const id = instanceOf(ctx, app, kind, ref);
        const out = { docs: {}, tables: {} };
        for (const [coll, rows] of Object.entries(docs || {})) {
          // documents are named by their id field when every row has one
          out.docs[coll] = await w.importDocs(id, coll, rows, rows.length && rows.every((r) => r && typeof r.id === 'string' && r.id) ? { id: 'id' } : {});
        }
        for (const [table, rows] of Object.entries(tables || {})) {
          out.tables[table] = await w.importTable(id, table, rows);
        }
        return out;
      },
    },

    // ---- proposals: refs proposal/<id> the person reviews ----

    // A new proposal at draft's snapshot: {ref, base, title}.
    propose: {
      requires: 'view',
      args: args({ app: S.store, title: S.text, thread: S.text }, ['app']),
      async run(ctx, { app, title, thread }) {
        const w = tool(ctx);
        const refs = await w.refs(app);
        if (refs.draft == null) ctx.fail('not_found', app + ' has no draft');
        const ref = 'proposal/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        await w.moveRef(app, ref, refs.draft, { ifAt: 0 });
        const t = text(title || 'Proposal', 120);
        sql.run('INSERT INTO proposals (app, ref, owner, title, thread, base, status, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          app, ref, ctx.visitor.id, t, thread ? text(thread, 80) : null, refs.draft, 'open', Date.now());
        return { ref, base: refs.draft, title: t, thread: thread || null, status: 'open', n: refs.draft };
      },
    },
    // The visitor's proposals for an app, open ones with where their ref is.
    proposals: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        const refs = await tool(ctx).refs(app);
        return sql.all('SELECT ref, title, thread, base, status, created, closed FROM proposals WHERE app = ? AND owner = ? ORDER BY created DESC LIMIT 200', app, ctx.visitor.id)
          .map((p) => Object.assign(p, { n: refs[p.ref] ?? null }));
      },
    },
    // Close a proposal (accepted: its changes were committed to draft;
    // rejected): its ref goes, if it still points at ifAt, and the visitor's
    // prop instance of it with it.
    closeProposal: {
      requires: 'view',
      args: args({ app: S.store, ref: S.proposal, status: { enum: ['accepted', 'rejected', 'discarded'] }, ifAt: S.n }, ['app', 'ref', 'status', 'ifAt']),
      async run(ctx, { app, ref, status, ifAt }) {
        const w = tool(ctx);
        // status discarded: an agent's proposal that ended with no changes (no event)
        const p = sql.one('SELECT owner, status, title FROM proposals WHERE app = ? AND ref = ?', app, ref);
        if (!p || p.owner !== ctx.visitor.id) ctx.fail('not_found', 'no proposal ' + ref);
        if (p.status !== 'open') ctx.fail('conflict', ref + ' is already ' + p.status);
        // the ref cannot go while a store follows it: the proposal's prop
        // instance goes with it, the visitor's test instance goes back to draft
        const prop = instanceOf(ctx, app, 'prop', ref), test = instanceId(app, ctx.visitor.id, 'test');
        const ps = await statusOf(ctx, prop, { peek: true });
        if (ps && ps.app === app) await w.drop(prop);
        const ts = await statusOf(ctx, test, { peek: true });
        if (ts && ts.ref === ref) await w.follow(test, 'draft');
        await w.dropRef(app, ref, { ifAt });
        sql.run('UPDATE proposals SET status = ?, closed = ? WHERE app = ? AND ref = ?', status, Date.now(), app, ref);
        if (status !== 'discarded') addEvent(ctx, app, { kind: status === 'accepted' ? 'accept' : 'reject', who: 'you', ref, n: ifAt, data: { title: p.title } });
        return { ref, status };
      },
    },

    // ---- publishing ----

    // What moving main to draft would do: the files that change, the
    // migrations that will run on every production instance, what blocks it
    // (a migration that changed or went away after it ran: production
    // instances would refuse the version), the production instances (stores
    // that follow main) and the visitor's dev instance, which should be
    // running this draft. Both trees are read at the snapshots in refs, the
    // ones publish is then given, so a commit in between cannot change what
    // was approved; and it only looks: nothing activates.
    preflight: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        const w = tool(ctx);
        const refs = await w.refs(app);
        if (refs.draft == null) ctx.fail('not_found', app + ' has no draft');
        const [draft, main] = await Promise.all([w.files(app, String(refs.draft)), refs.main != null ? w.files(app, String(refs.main)) : []]);
        const dm = new Map(draft.map((f) => [f.path, f])), mm = new Map(main.map((f) => [f.path, f]));
        const added = [], changed = [], removed = [];
        for (const [path, f] of dm) { const m = mm.get(path); if (!m) added.push(path); else if (m.sha256 !== f.sha256) changed.push(path); }
        for (const path of mm.keys()) if (!dm.has(path)) removed.push(path);
        const mig = (path) => /^sql\/.+\.sql$/.test(path);
        const blockers = [
          ...changed.filter(mig).map((path) => 'migration ' + path + ' changed after it ran on main: add a new migration instead'),
          ...removed.filter(mig).map((path) => 'migration ' + path + ' was removed after it ran on main'),
        ];
        const instances = (await allStores(ctx)).filter((s) => s.app === app).map((s) => s.id);
        const production = [], ranElsewhere = new Map(); // path → stores where another version of it ran
        for (const id of [app, ...instances]) {
          const st = await statusOf(ctx, id, { peek: true, migrations: true });
          if (!st || !(st.manifest || st.next) || (st.ref || 'main') !== 'main') continue;
          production.push({ store: id, n: st.n, next: st.next || 0, broken: st.broken || '' });
          // what an instance ran is what counts: main may have been rolled
          // back past a migration that it still has
          for (const [path, sum] of Object.entries(st.applied || {})) {
            const f = dm.get(path);
            if (f && f.sha256 !== sum && !changed.includes(path)) ranElsewhere.set(path, [...(ranElsewhere.get(path) || []), id]);
          }
        }
        for (const [path, ids] of ranElsewhere) blockers.push('migration ' + path + ' differs from the one that ran on ' + ids.join(', ') + ': add a new migration instead');
        const dev = await statusOf(ctx, instanceId(app, ctx.visitor.id, 'dev'), { peek: true });
        return { refs, added, changed, removed, migrations: added.filter(mig), blockers, production, dev: dev ? { n: dev.n, next: dev.next || 0, broken: dev.broken || '' } : null };
      },
    },
    // Move main to snapshot n, only if main is still at ifAt (0: main does
    // not exist yet), so two publishers cannot overwrite each other. The
    // answer's from is where main was: publishing that again rolls back.
    publish: {
      requires: 'view',
      args: args({ app: S.store, n: { type: 'integer', minimum: 1 }, ifAt: S.n, note: S.text }, ['app', 'n', 'ifAt']),
      async run(ctx, { app, n, ifAt, note }) {
        const r = await tool(ctx).publish(app, n, { ifAt });
        addEvent(ctx, app, { kind: 'publish', who: 'you', ref: 'main', n, data: { from: r.from, note: text(note, 300) } });
        return r;
      },
    },
    // Bring a production instance up on the version it follows now
    // ("Activate now"; otherwise it does on its next view or event).
    activate: {
      requires: 'view',
      args: args({ store: S.store }, ['store']),
      async run(ctx, { store }) {
        const st = await tool(ctx).status(store);
        return { store, n: st.n, broken: st.broken || '' };
      },
    },

    // ---- what the bench keeps per person and app ----

    // The project: its meta (null the first time), its threads (without
    // messages), the newest events of its timeline (up to limit) and its
    // proposals.
    project: {
      requires: 'view',
      args: args({ app: S.store, limit: { type: 'integer', minimum: 1, maximum: 10000 } }, ['app']),
      async run(ctx, { app, limit }) {
        const me = ctx.visitor.id;
        const p = sql.one('SELECT meta FROM projects WHERE app = ? AND owner = ?', app, me);
        const threads = sql.all('SELECT t.id, t.meta, t.created, t.updated, (SELECT count(*) FROM messages m WHERE m.thread = t.id) AS count FROM threads t WHERE t.app = ? AND t.owner = ? ORDER BY t.updated DESC', app, me)
          .map((t) => ({ id: t.id, meta: json(t.meta) || {}, created: t.created, updated: t.updated, count: t.count }));
        const lim = limit || 2000;
        const events = sql.all('SELECT * FROM (SELECT * FROM events WHERE app = ? AND owner = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq', app, me, lim).map(eventOut);
        return { meta: p ? json(p.meta) : null, threads, events };
      },
    },
    saveProject: {
      requires: 'view',
      args: args({ app: S.store, meta: S.obj }, ['app']),
      async run(ctx, { app, meta }) {
        const v = JSON.stringify(meta || {});
        if (v.length > 2 << 20) ctx.fail('invalid_argument', 'project meta is at most 2 MiB');
        sql.run('INSERT INTO projects (app, owner, meta, updated) VALUES (?, ?, ?, ?) ON CONFLICT (app, owner) DO UPDATE SET meta = excluded.meta, updated = excluded.updated',
          app, ctx.visitor.id, v, Date.now());
        return { saved: true };
      },
    },
    // Forget an app's project here (the app store and its instances stay).
    forget: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        const me = ctx.visitor.id;
        sql.run('DELETE FROM messages WHERE thread IN (SELECT id FROM threads WHERE app = ? AND owner = ?)', app, me);
        for (const t of ['threads', 'events', 'snaps', 'projects']) sql.run('DELETE FROM ' + t + ' WHERE app = ? AND owner = ?', app, me);
        return { forgot: app };
      },
    },
    // A thread with its messages, in order.
    thread: {
      requires: 'view',
      args: args({ id: S.str }, ['id']),
      async run(ctx, { id }) {
        const t = ownThread(ctx, id);
        if (!t) ctx.fail('not_found', 'no thread ' + id);
        const row = sql.one('SELECT meta, created, updated FROM threads WHERE id = ?', t.id);
        const messages = sql.all('SELECT body FROM messages WHERE thread = ? ORDER BY seq', t.id).map((m) => json(m.body));
        return { id: t.id, meta: json(row.meta) || {}, created: row.created, updated: row.updated, messages };
      },
    },
    // Save a thread's meta and, when given, its messages from position from
    // (1-based) on: those replace what is there from that position, so a
    // reply that grows is saved again in place.
    saveThread: {
      requires: 'view',
      args: args({ id: S.id, app: S.store, meta: S.obj, from: { type: 'integer', minimum: 1 }, messages: { type: 'array' } }, ['id', 'app']),
      async run(ctx, { id, app, meta, from, messages }) {
        const t = ownThread(ctx, id);
        if (t && t.app !== app) ctx.fail('invalid_argument', 'thread ' + id + ' belongs to ' + t.app);
        const now = Date.now();
        sql.run('INSERT INTO threads (id, app, owner, meta, created, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET meta = excluded.meta, updated = excluded.updated',
          id, app, ctx.visitor.id, JSON.stringify(meta || {}), now, now);
        if (messages) {
          const start = from || 1;
          sql.run('DELETE FROM messages WHERE thread = ? AND seq >= ?', id, start);
          messages.forEach((m, i) => sql.run('INSERT INTO messages (thread, seq, body) VALUES (?, ?, ?)', id, start + i, JSON.stringify(m)));
        }
        return { id, updated: now };
      },
    },
    dropThread: {
      requires: 'view',
      args: args({ id: S.str }, ['id']),
      async run(ctx, { id }) {
        const t = ownThread(ctx, id);
        if (!t) return { dropped: false };
        sql.run('DELETE FROM messages WHERE thread = ?', t.id);
        sql.run('DELETE FROM threads WHERE id = ?', t.id);
        return { dropped: true };
      },
    },
    // Add events to the visitor's timeline ([{kind, who, thread, ref, n,
    // …data}], each on a ref with that ref's snapshot); the answer has them
    // numbered (an 'outside' change already on the timeline answers with the
    // event there). A batch with a bad event is refused whole, before any is
    // written: retrying it cannot help.
    logEvents: {
      requires: 'view',
      args: args({ app: S.store, events: { type: 'array', maxItems: 200, items: { type: 'object', required: ['kind', 'ref', 'n'], properties: { kind: { type: 'string', minLength: 1 }, ref: { type: 'string', minLength: 1 }, n: { type: 'integer', minimum: 1 }, who: S.text, thread: S.text } } } }, ['app', 'events']),
      async run(ctx, { app, events }) {
        events.forEach((e, i) => {
          if (e.kind === 'commit') ctx.fail('invalid_argument', 'events[' + i + '] is a commit (commits are logged by commit)');
        });
        return events.map((e) => {
          const { kind, who, thread, ref, n } = e;
          // A change seen from outside may already be on this timeline: the
          // person's own commit from another tab, or another tab's report of
          // the same push. The answer is then the event already there.
          if (kind === 'outside') {
            const known = sql.one("SELECT * FROM events WHERE app = ? AND owner = ? AND ref = ? AND n = ? AND kind IN ('commit', 'outside') ORDER BY seq LIMIT 1", app, ctx.visitor.id, ref, n);
            if (known) return eventOut(known);
          }
          const data = Object.assign({}, e);
          for (const k of ['kind', 'who', 'thread', 'ref', 'n', 'seq', 'at']) delete data[k];
          return addEvent(ctx, app, { kind, who, thread, ref, n, data });
        });
      },
    },
    // Older events: up to limit before seq before.
    events: {
      requires: 'view',
      args: args({ app: S.store, before: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 5000 } }, ['app']),
      async run(ctx, { app, before, limit }) {
        const lim = limit || 500;
        return sql.all('SELECT * FROM (SELECT * FROM events WHERE app = ? AND owner = ? AND seq < ? ORDER BY seq DESC LIMIT ?) ORDER BY seq',
          app, ctx.visitor.id, before ?? 1e15, lim).map(eventOut);
      },
    },
    // Layout snapshots of frames: the list (meta only), one with its document
    // ({html, css, layout, scroll}: a frozen page), saving one.
    snaps: {
      requires: 'view',
      args: args({ app: S.store }, ['app']),
      async run(ctx, { app }) {
        return sql.all('SELECT id, at, meta FROM snaps WHERE app = ? AND owner = ? ORDER BY at', app, ctx.visitor.id)
          .map((s) => Object.assign(json(s.meta) || {}, { id: s.id, t: s.at }));
      },
    },
    snap: {
      requires: 'view',
      args: args({ id: S.str }, ['id']),
      async run(ctx, { id }) {
        const s = sql.one('SELECT id, at, meta, doc, owner FROM snaps WHERE id = ?', text(id, 80));
        if (!s || s.owner !== ctx.visitor.id) ctx.fail('not_found', 'no snapshot ' + id);
        return Object.assign(json(s.meta) || {}, { id: s.id, t: s.at, doc: json(s.doc) });
      },
    },
    saveSnap: {
      requires: 'view',
      args: args({ id: S.id, app: S.store, meta: S.obj }, ['id', 'app']),
      async run(ctx, { id, app, meta, doc }) {
        const d = JSON.stringify(doc || null);
        if (d.length > 4 << 20) ctx.fail('invalid_argument', 'a snapshot is at most 4 MiB');
        sql.run('INSERT INTO snaps (id, app, owner, at, meta, doc) VALUES (?, ?, ?, ?, ?, ?)', id, app, ctx.visitor.id, Date.now(), JSON.stringify(meta || {}), d);
        return { id };
      },
    },
  },
});
