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
// Instances: what each kind follows (prop: the proposal it was pointed at).
const KINDS = { dev: 'draft', test: 'draft', prop: '' };

function tool(ctx) {
  if (!ws) ctx.fail('unavailable', 'the bench is not trusted with the workshop module (slop app trust <store> workshop)');
  return ws;
}
function storeId(ctx, id, what) {
  if (typeof id !== 'string' || !ID.test(id)) ctx.fail('invalid_argument', (what || 'app') + ' must be a store id: lowercase letters, digits and -');
  return id;
}
// A snapshot number (0: none, for a ref that does not exist yet).
function snap(ctx, n, what) {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) ctx.fail('invalid_argument', (what || 'n') + ' must be a snapshot number');
  return n;
}
function benchRef(ctx, ref) {
  if (ref !== 'draft' && !(typeof ref === 'string' && PROPOSAL.test(ref))) ctx.fail('invalid_argument', 'ref must be draft or proposal/<id>');
  return ref;
}
function kindOf(ctx, kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) ctx.fail('invalid_argument', 'kind must be dev, test or prop');
  return kind;
}
function text(v, max) { return String(v == null ? '' : v).slice(0, max); }
function json(v) { try { return JSON.parse(v); } catch (e) { return null; } }

// A person's instance of an app: <app>-<kind>-<the first six characters of
// their id> (dev is the same name as `slop dev`, pkg/client/dev.go).
function instanceId(app, person, kind) {
  const tail = '-' + kind + '-' + String(person || '').replace(/^usr_/, '').toLowerCase().slice(0, 6);
  return app.slice(0, 63 - tail.length) + tail;
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

// The visitor's timeline: events are numbered per app and person.
function addEvent(ctx, app, e) {
  const row = sql.one('SELECT coalesce(max(seq), 0) + 1 AS seq FROM events WHERE app = ? AND owner = ?', app, ctx.visitor.id);
  const at = Date.now();
  const data = Object.assign({}, e.data || {});
  sql.run('INSERT INTO events (app, owner, seq, at, who, kind, thread, ref, n, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    app, ctx.visitor.id, row.seq, at, text(e.who || 'you', 20), text(e.kind, 30), e.thread ? text(e.thread, 80) : null,
    e.ref ? text(e.ref, 80) : null, typeof e.n === 'number' ? e.n : null, JSON.stringify(data));
  return eventOut({ seq: row.seq, at, who: e.who || 'you', kind: e.kind, thread: e.thread || null, ref: e.ref || null, n: typeof e.n === 'number' ? e.n : null, data: JSON.stringify(data) });
}
function eventOut(r) {
  return Object.assign(json(r.data) || {}, { seq: r.seq, at: r.at, who: r.who, kind: r.kind, thread: r.thread || null, ref: r.ref || null, n: r.n == null ? null : r.n });
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
  for (const kind of Object.keys(KINDS)) {
    const id = instanceId(app, ctx.visitor.id, kind);
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
    apps: {
      requires: 'view',
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
      async run(ctx, { app }) {
        const w = tool(ctx);
        storeId(ctx, app);
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
    // exist until the first publish).
    create: {
      requires: 'view',
      async run(ctx, { id, type, files }) {
        const w = tool(ctx);
        storeId(ctx, id, 'id');
        if (!Array.isArray(files) || !files.length) ctx.fail('invalid_argument', 'a new app needs files: [{path, text}]');
        await w.newStore(id, type ? { type: text(type, 63) } : {});
        const r = await w.commit(id, files.map((f) => ({ path: text(f.path, 512), text: String(f.text) })), { ref: 'draft', base: 0, message: 'created in the bench' });
        return { app: id, n: r.n };
      },
    },

    // ---- files: read at snapshot numbers, changed by commits ----

    // Where a ref points: {n} (0: it does not exist).
    head: {
      requires: 'view',
      async run(ctx, { app, ref }) {
        storeId(ctx, app);
        const refs = await tool(ctx).refs(app);
        return { n: refs[benchRef(ctx, ref)] ?? 0 };
      },
    },
    // The listing of snapshot n: [{path, sha256, size, type}].
    files: {
      requires: 'view',
      async run(ctx, { app, at }) {
        storeId(ctx, app);
        return listing(await tool(ctx).files(app, String(snap(ctx, at, 'at'))));
      },
    },
    // File texts at snapshot n: {texts: {path: text}, binary: [path], more:
    // [path]} (more: what did not fit in this answer).
    read: {
      requires: 'view',
      async run(ctx, { app, at, paths }) {
        const w = tool(ctx);
        storeId(ctx, app);
        const n = String(snap(ctx, at, 'at'));
        const texts = {}, binary = [], more = [];
        let used = 0;
        for (const path of Array.isArray(paths) ? paths : []) {
          if (used > READ_BUDGET) { more.push(path); continue; }
          const v = await w.read(app, n, String(path));
          if (typeof v === 'string') { texts[path] = v; used += v.length; } else binary.push(path);
        }
        return { texts, binary, more };
      },
    },
    // Commit changes ([{path, text} | {path, delete: true}]) to a ref over
    // snapshot base. The server merges them over what was committed since,
    // file by file; when someone else changed one of these paths to
    // something else, nothing is written and the answer is {conflict: {at,
    // paths}}. Otherwise the visitor's instances that follow the ref come up
    // on the new snapshot, the commit goes on the timeline (event: {who,
    // thread, note}), and the answer is {n, at, merged, files (n's listing),
    // activated, event}.
    commit: {
      requires: 'view',
      async run(ctx, { app, ref, base, changes, message, event }) {
        const w = tool(ctx);
        storeId(ctx, app);
        benchRef(ctx, ref);
        snap(ctx, base, 'base');
        if (!Array.isArray(changes) || !changes.length) ctx.fail('invalid_argument', 'changes is a non-empty list of {path, text} or {path, delete: true}');
        const list = changes.map((c) => (c && c.delete === true ? { path: text(c.path, 512), delete: true } : { path: text(c && c.path, 512), text: String(c && c.text) }));
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

    // ---- instances: the visitor's dev, test and prop stores of an app ----

    // Where the app's refs are and what the visitor's instances run (peeked:
    // nothing activates by being asked): {refs, dev, test, prop}, each
    // instance {id, ref, n, next, broken} or null when it does not exist.
    status: {
      requires: 'view',
      async run(ctx, { app }) {
        storeId(ctx, app);
        const out = { refs: await tool(ctx).refs(app) };
        for (const kind of Object.keys(KINDS)) {
          const id = instanceId(app, ctx.visitor.id, kind);
          const st = await statusOf(ctx, id, { peek: true });
          out[kind] = st && st.app === app ? { id, ref: st.ref || '', n: st.n || 0, next: st.next || 0, broken: st.broken || '' } : null;
        }
        return out;
      },
    },
    // The visitor's instance of a kind, made the first time: a store that
    // runs the app at a ref (dev: draft; test: draft or the proposal given;
    // prop: the proposal given), with its own data, typed as the app's manifest says so the
    // app's typed mounts serve it. Asking brings it up on its ref.
    instance: {
      requires: 'view',
      async run(ctx, { app, kind, ref }) {
        const w = tool(ctx);
        storeId(ctx, app);
        kindOf(ctx, kind);
        // dev follows draft; test follows draft or the proposal given; prop a proposal
        const follow = kind === 'dev' ? 'draft' : ref || KINDS[kind];
        if (!follow || !(follow === 'draft' || PROPOSAL.test(follow))) ctx.fail('invalid_argument', 'a prop instance follows a proposal ref: pass ref');
        const id = instanceId(app, ctx.visitor.id, kind);
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
    // Throw an instance and its data away (it runs unpublished code, so
    // workshop's drop allows it); the next use makes a fresh one.
    reset: {
      requires: 'view',
      async run(ctx, { app, kind }) {
        storeId(ctx, app);
        const id = instanceId(app, ctx.visitor.id, kindOf(ctx, kind));
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
      async run(ctx, { app, kind }) {
        storeId(ctx, app);
        return await tool(ctx).embed(instanceId(app, ctx.visitor.id, kindOf(ctx, kind)), { dev: true });
      },
    },
    renew: {
      requires: 'view',
      async run(ctx, { view }) {
        return await tool(ctx).renewEmbed(text(view, 200));
      },
    },
    close: {
      requires: 'view',
      async run(ctx, { view }) {
        return await tool(ctx).closeEmbed(text(view, 200));
      },
    },
    // An instance's log (its actor's console, setup and activation
    // failures): {broken, lines: [{at, level, text}]}.
    logs: {
      requires: 'view',
      async run(ctx, { app, kind }) {
        storeId(ctx, app);
        return await tool(ctx).logs(instanceId(app, ctx.visitor.id, kindOf(ctx, kind))).catch(() => ({ broken: '', lines: [] }));
      },
    },
    // An instance's data: its documents, its SQL (read-only), and seeding it
    // ({docs: {coll: [rows]}, tables: {name: [rows]}}). These reach the
    // visitor's own instances only, never a production one.
    docs: {
      requires: 'view',
      async run(ctx, { app, kind, coll }) {
        storeId(ctx, app);
        return await tool(ctx).docs(instanceId(app, ctx.visitor.id, kindOf(ctx, kind)), text(coll, 200));
      },
    },
    doc: {
      requires: 'view',
      async run(ctx, { app, kind, path }) {
        storeId(ctx, app);
        return await tool(ctx).doc(instanceId(app, ctx.visitor.id, kindOf(ctx, kind)), text(path, 400));
      },
    },
    sql: {
      requires: 'view',
      async run(ctx, { app, kind, query, args }) {
        storeId(ctx, app);
        return await tool(ctx).sql(instanceId(app, ctx.visitor.id, kindOf(ctx, kind)), text(query, 20000), Array.isArray(args) ? args : []);
      },
    },
    seed: {
      requires: 'view',
      async run(ctx, { app, kind, docs, tables }) {
        const w = tool(ctx);
        storeId(ctx, app);
        const id = instanceId(app, ctx.visitor.id, kindOf(ctx, kind));
        const out = { docs: {}, tables: {} };
        for (const [coll, rows] of Object.entries(docs || {})) {
          if (!Array.isArray(rows)) ctx.fail('invalid_argument', 'docs.' + coll + ' must be a list of objects');
          // documents are named by their id field when every row has one
          out.docs[coll] = await w.importDocs(id, coll, rows, rows.length && rows.every((r) => r && typeof r.id === 'string' && r.id) ? { id: 'id' } : {});
        }
        for (const [table, rows] of Object.entries(tables || {})) {
          if (!Array.isArray(rows)) ctx.fail('invalid_argument', 'tables.' + table + ' must be a list of objects');
          out.tables[table] = await w.importTable(id, table, rows);
        }
        return out;
      },
    },

    // ---- proposals: refs proposal/<id> the person reviews ----

    // A new proposal at draft's snapshot: {ref, base, title}.
    propose: {
      requires: 'view',
      async run(ctx, { app, title, thread }) {
        const w = tool(ctx);
        storeId(ctx, app);
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
      async run(ctx, { app }) {
        storeId(ctx, app);
        const refs = await tool(ctx).refs(app);
        return sql.all('SELECT ref, title, thread, base, status, created, closed FROM proposals WHERE app = ? AND owner = ? ORDER BY created DESC LIMIT 200', app, ctx.visitor.id)
          .map((p) => Object.assign(p, { n: refs[p.ref] ?? null }));
      },
    },
    // Close a proposal (accepted: its changes were committed to draft;
    // rejected): its ref goes, if it still points at ifAt, and the visitor's
    // prop instance with it when it follows that ref.
    closeProposal: {
      requires: 'view',
      async run(ctx, { app, ref, status, ifAt }) {
        const w = tool(ctx);
        storeId(ctx, app);
        if (!PROPOSAL.test(ref || '')) ctx.fail('invalid_argument', 'ref must be proposal/<id>');
        // discarded: an agent's proposal that ended with no changes (no event)
        if (status !== 'accepted' && status !== 'rejected' && status !== 'discarded') ctx.fail('invalid_argument', 'status is accepted, rejected or discarded');
        const p = sql.one('SELECT owner, status, title FROM proposals WHERE app = ? AND ref = ?', app, ref);
        if (!p || p.owner !== ctx.visitor.id) ctx.fail('not_found', 'no proposal ' + ref);
        if (p.status !== 'open') ctx.fail('conflict', ref + ' is already ' + p.status);
        // the ref cannot go while a store follows it: the visitor's prop
        // instance goes with it, their test instance goes back to draft
        const prop = instanceId(app, ctx.visitor.id, 'prop'), test = instanceId(app, ctx.visitor.id, 'test');
        const ps = await statusOf(ctx, prop, { peek: true });
        if (ps && ps.ref === ref) await w.drop(prop);
        const ts = await statusOf(ctx, test, { peek: true });
        if (ts && ts.ref === ref) await w.follow(test, 'draft');
        await w.dropRef(app, ref, { ifAt: snap(ctx, ifAt, 'ifAt') });
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
      async run(ctx, { app }) {
        const w = tool(ctx);
        storeId(ctx, app);
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
      async run(ctx, { app, n, ifAt, note }) {
        storeId(ctx, app);
        if (!(snap(ctx, n) > 0)) ctx.fail('invalid_argument', 'n is the snapshot to publish');
        const r = await tool(ctx).publish(app, n, { ifAt: snap(ctx, ifAt, 'ifAt') });
        addEvent(ctx, app, { kind: 'publish', who: 'you', ref: 'main', n, data: { from: r.from, note: text(note, 300) } });
        return r;
      },
    },
    // Bring a production instance up on the version it follows now
    // ("Activate now"; otherwise it does on its next view or event).
    activate: {
      requires: 'view',
      async run(ctx, { store }) {
        storeId(ctx, store, 'store');
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
      async run(ctx, { app, limit }) {
        storeId(ctx, app);
        const me = ctx.visitor.id;
        const p = sql.one('SELECT meta FROM projects WHERE app = ? AND owner = ?', app, me);
        const threads = sql.all('SELECT t.id, t.meta, t.created, t.updated, (SELECT count(*) FROM messages m WHERE m.thread = t.id) AS count FROM threads t WHERE t.app = ? AND t.owner = ? ORDER BY t.updated DESC', app, me)
          .map((t) => ({ id: t.id, meta: json(t.meta) || {}, created: t.created, updated: t.updated, count: t.count }));
        const lim = Math.min(Math.max(Number(limit) || 2000, 1), 10000);
        const events = sql.all('SELECT * FROM (SELECT * FROM events WHERE app = ? AND owner = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq', app, me, lim).map(eventOut);
        return { meta: p ? json(p.meta) : null, threads, events };
      },
    },
    saveProject: {
      requires: 'view',
      async run(ctx, { app, meta }) {
        storeId(ctx, app);
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
      async run(ctx, { app }) {
        storeId(ctx, app);
        const me = ctx.visitor.id;
        sql.run('DELETE FROM messages WHERE thread IN (SELECT id FROM threads WHERE app = ? AND owner = ?)', app, me);
        for (const t of ['threads', 'events', 'snaps', 'projects']) sql.run('DELETE FROM ' + t + ' WHERE app = ? AND owner = ?', app, me);
        return { forgot: app };
      },
    },
    // A thread with its messages, in order.
    thread: {
      requires: 'view',
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
      async run(ctx, { id, app, meta, from, messages }) {
        storeId(ctx, app);
        if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) ctx.fail('invalid_argument', 'id is a thread id');
        const t = ownThread(ctx, id);
        if (t && t.app !== app) ctx.fail('invalid_argument', 'thread ' + id + ' belongs to ' + t.app);
        const now = Date.now();
        sql.run('INSERT INTO threads (id, app, owner, meta, created, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET meta = excluded.meta, updated = excluded.updated',
          id, app, ctx.visitor.id, JSON.stringify(meta || {}), now, now);
        if (Array.isArray(messages)) {
          const start = Math.max(1, Math.floor(Number(from) || 1));
          sql.run('DELETE FROM messages WHERE thread = ? AND seq >= ?', id, start);
          messages.forEach((m, i) => sql.run('INSERT INTO messages (thread, seq, body) VALUES (?, ?, ?)', id, start + i, JSON.stringify(m)));
        }
        return { id, updated: now };
      },
    },
    dropThread: {
      requires: 'view',
      async run(ctx, { id }) {
        const t = ownThread(ctx, id);
        if (!t) return { dropped: false };
        sql.run('DELETE FROM messages WHERE thread = ?', t.id);
        sql.run('DELETE FROM threads WHERE id = ?', t.id);
        return { dropped: true };
      },
    },
    // Add events to the visitor's timeline ([{kind, who, thread, ref, n,
    // …data}]); the answer has them numbered.
    logEvents: {
      requires: 'view',
      async run(ctx, { app, events }) {
        storeId(ctx, app);
        if (!Array.isArray(events)) ctx.fail('invalid_argument', 'events is a list');
        return events.slice(0, 200).map((e) => {
          const { kind, who, thread, ref, n } = e || {};
          if (typeof kind !== 'string' || !kind || kind === 'commit') ctx.fail('invalid_argument', 'an event has a kind (commits are logged by commit)');
          const data = Object.assign({}, e);
          for (const k of ['kind', 'who', 'thread', 'ref', 'n', 'seq', 'at']) delete data[k];
          return addEvent(ctx, app, { kind, who, thread, ref, n, data });
        });
      },
    },
    // Older events: up to limit before seq before.
    events: {
      requires: 'view',
      async run(ctx, { app, before, limit }) {
        storeId(ctx, app);
        const lim = Math.min(Math.max(Number(limit) || 500, 1), 5000);
        return sql.all('SELECT * FROM (SELECT * FROM events WHERE app = ? AND owner = ? AND seq < ? ORDER BY seq DESC LIMIT ?) ORDER BY seq',
          app, ctx.visitor.id, Number(before) || 1e15, lim).map(eventOut);
      },
    },
    // Layout snapshots of frames: the list (meta only), one with its document
    // ({html, css, layout, scroll}: a frozen page), saving one.
    snaps: {
      requires: 'view',
      async run(ctx, { app }) {
        storeId(ctx, app);
        return sql.all('SELECT id, at, meta FROM snaps WHERE app = ? AND owner = ? ORDER BY at', app, ctx.visitor.id)
          .map((s) => Object.assign(json(s.meta) || {}, { id: s.id, t: s.at }));
      },
    },
    snap: {
      requires: 'view',
      async run(ctx, { id }) {
        const s = sql.one('SELECT id, at, meta, doc, owner FROM snaps WHERE id = ?', text(id, 80));
        if (!s || s.owner !== ctx.visitor.id) ctx.fail('not_found', 'no snapshot ' + id);
        return Object.assign(json(s.meta) || {}, { id: s.id, t: s.at, doc: json(s.doc) });
      },
    },
    saveSnap: {
      requires: 'view',
      async run(ctx, { id, app, meta, doc }) {
        storeId(ctx, app);
        if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) ctx.fail('invalid_argument', 'id is a snapshot id');
        const d = JSON.stringify(doc || null);
        if (d.length > 4 << 20) ctx.fail('invalid_argument', 'a snapshot is at most 4 MiB');
        sql.run('INSERT INTO snaps (id, app, owner, at, meta, doc) VALUES (?, ?, ?, ?, ?, ?)', id, app, ctx.visitor.id, Date.now(), JSON.stringify(meta || {}), d);
        return { id };
      },
    },
  },
});
