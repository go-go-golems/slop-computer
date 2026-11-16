// The bench's server half (SLOP3-022): projects are app stores. The page
// (Sitebench, built from web/bench) keeps its threads, timeline, boards and
// proposals in this store's documents; an app's code lives in the app's own
// store, at the draft ref, which the page pushes on every edit. Production
// instances follow main and only move when someone publishes. Every call
// goes through the workshop module, as the visiting person: the bench can do
// nothing they could not do with the CLI. Install:
//   slop push apps/bench --store bench
//   slop app trust bench workshop
//   slop mount set <live host> /bench bench
const ws = use('workshop');

// A store id (pkg/registry/stores.go).
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
// How many bytes of file text one read answers with; the page asks again
// for the rest.
const READ_BUDGET = 4 << 20;

function tool(ctx) {
  if (!ws) ctx.fail('unavailable', 'the bench is not trusted with the workshop module (slop app trust <store> workshop)');
  return ws;
}

function storeId(ctx, id, what) {
  if (typeof id !== 'string' || !ID.test(id)) ctx.fail('invalid_argument', (what || 'app') + ' must be a store id: lowercase letters, digits and -');
  return id;
}

// A person's dev instance of an app: <app>-dev-<the first six characters of
// their id> (the same name as `slop dev`, pkg/client/dev.go).
function devId(app, person) {
  const suf = String(person || '').replace(/^usr_/, '').toLowerCase().slice(0, 6);
  const tail = '-dev-' + suf;
  return app.slice(0, 63 - tail.length) + tail;
}

async function allStores(ctx) {
  return await tool(ctx).stores({ all: ctx.visitor.audience === 'admin' });
}

// A store that does not exist, or that the visitor cannot read, has no
// status; neither case is an error here. Asking activates a newer version
// the store follows; with {peek: true} it only looks ({n: running now,
// next: the version it activates on its next use}); with {migrations:
// true} the answer has applied: {sql/… name: sha256} of what ran there.
async function statusOf(ctx, id, opts) {
  try { return await tool(ctx).status(id, opts || {}); } catch (e) { return null; }
}

defineActor({
  actions: {
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
        const dev = (id) => devId(id, ctx.visitor.id);
        return mine.map((s, i) => ({ id: s.id, type: s.type || '', refs: refs[i], instances: inst[s.id] || [], dev: (inst[s.id] || []).includes(dev(s.id)) ? dev(s.id) : '' }));
      },
    },

    // Open an app for editing: its draft (made from main the first time),
    // the files at draft ({path, sha256, size, type}), its instances and the
    // visitor's dev instance, if there is one.
    open: {
      requires: 'view',
      async run(ctx, { app }) {
        const w = tool(ctx);
        storeId(ctx, app);
        let refs = await w.refs(app);
        if (refs.draft == null && refs.main != null) {
          await w.moveRef(app, 'draft', refs.main, { ifAt: 0 }).catch(() => null); // someone else may have made it
          refs = await w.refs(app);
        }
        const files = refs.draft != null ? await w.files(app, 'draft') : [];
        const all = await allStores(ctx);
        const dev = devId(app, ctx.visitor.id);
        const instances = all.filter((s) => s.app === app).map((s) => s.id);
        return { app, refs, files, instances, dev, devStatus: instances.includes(dev) ? await statusOf(ctx, dev) : null };
      },
    },

    // File texts at a snapshot or ref: {texts: {path: text}, binary: [path],
    // more: [path]} (more: what did not fit in this answer).
    read: {
      requires: 'view',
      async run(ctx, { app, at, paths }) {
        const w = tool(ctx);
        storeId(ctx, app);
        const texts = {}, binary = [], more = [];
        let used = 0;
        for (const path of Array.isArray(paths) ? paths : []) {
          if (used > READ_BUDGET) { more.push(path); continue; }
          const v = await w.read(app, String(at || 'draft'), String(path));
          if (typeof v === 'string') { texts[path] = v; used += v.length; } else binary.push(path);
        }
        return { texts, binary, more };
      },
    },

    // Push the project's tree to draft: files are {path, text} for what
    // changed and {path, sha256, size} for the rest (files not listed are
    // deleted). base is the draft the tree was made from: when draft moved
    // since (a push from a terminal, another person), nothing is pushed and
    // the answer is {conflict, n, files}, the draft as it is now, for the
    // page to merge; the push checks base in the same turn that writes it
    // (ifAt), so a push landing in between is never overwritten. Otherwise
    // the visitor's dev instance, when it exists, comes up on the new
    // snapshot and says how that went; the answer has the new tree.
    sync: {
      requires: 'view',
      async run(ctx, { app, files, message, base }) {
        const w = tool(ctx);
        storeId(ctx, app);
        if (!Array.isArray(files)) ctx.fail('invalid_argument', 'files must be a list of {path, text} or {path, sha256, size}');
        const moved = async () => {
          const refs = await w.refs(app);
          return { conflict: true, n: refs.draft ?? null, files: refs.draft != null ? await w.files(app, 'draft') : [] };
        };
        const dev = devId(app, ctx.visitor.id);
        const devExists = (await statusOf(ctx, dev)) !== null;
        const opts = { ref: 'draft', message: String(message || 'bench').slice(0, 200), activate: devExists ? [dev] : [] };
        if (base !== undefined) opts.ifAt = base ?? 0;
        let res;
        try {
          res = await w.push(app, files, opts);
        } catch (e) {
          if (e && e.code === 'conflict') return await moved();
          throw e;
        }
        return { n: res.n, activated: res.activated || [], files: await w.files(app, 'draft') };
      },
    },

    // Where draft is, and the visitor's dev instance on it ({n, broken},
    // null when there is none; asking brings it up on draft); with base,
    // also draft's tree when it is not base.
    head: {
      requires: 'view',
      async run(ctx, { app, base }) {
        const w = tool(ctx);
        storeId(ctx, app);
        const refs = await w.refs(app);
        const st = await statusOf(ctx, devId(app, ctx.visitor.id));
        const out = { refs, dev: st ? { store: st.store || devId(app, ctx.visitor.id), n: st.n, broken: st.broken || '' } : null };
        if (base !== undefined && (refs.draft ?? null) !== (base ?? null)) out.files = refs.draft != null ? await w.files(app, 'draft') : [];
        return out;
      },
    },

    // The visitor's dev instance's log (its actor's console, setup and
    // activation failures): {broken, lines: [{at, level, text}]}.
    logs: {
      requires: 'view',
      async run(ctx, { app }) {
        storeId(ctx, app);
        return await tool(ctx).logs(devId(app, ctx.visitor.id)).catch(() => ({ broken: '', lines: [] }));
      },
    },

    // Throw away the visitor's dev instance and its data (it runs
    // unpublished code, so workshop's drop allows it); the next frame makes
    // a fresh one. For a migration that changed after it was applied.
    resetDev: {
      requires: 'view',
      async run(ctx, { app }) {
        storeId(ctx, app);
        const id = devId(app, ctx.visitor.id);
        if ((await statusOf(ctx, id)) !== null) await tool(ctx).drop(id);
        return { dropped: id };
      },
    },

    // The visitor's dev instance of an app, made the first time: a store
    // that runs the app at draft, with its own (empty) data, typed as the
    // app's manifest says so the app's typed mounts serve it.
    dev: {
      requires: 'view',
      async run(ctx, { app }) {
        const w = tool(ctx);
        storeId(ctx, app);
        const id = devId(app, ctx.visitor.id);
        let status = await statusOf(ctx, id);
        if (!status) {
          let type = '';
          try { type = JSON.parse(await w.read(app, 'draft', 'app.json')).type || ''; } catch (e) { /* no manifest, or not JSON: no type */ }
          await w.newStore(id, type ? { app, type: String(type) } : { app });
          await w.follow(id, 'draft');
          status = await statusOf(ctx, id);
        } else if (status.app !== app) {
          ctx.fail('conflict', id + ' runs ' + status.app + ', not ' + app);
        } else if (status.ref !== 'draft') {
          await w.follow(id, 'draft');
          status = await statusOf(ctx, id);
        }
        return { id, status };
      },
    },

    // A dev view of the visitor's dev instance of an app, framed by the
    // bench's page: {src, view, secret, version, expiresAt, origin, …}. The
    // page answers the framed runtime's hello with the view and secret, and
    // its renew through renew below.
    embed: {
      requires: 'view',
      async run(ctx, { app }) {
        storeId(ctx, app);
        return await tool(ctx).embed(devId(app, ctx.visitor.id), { dev: true });
      },
    },
    renew: {
      requires: 'view',
      async run(ctx, { view }) {
        return await tool(ctx).renewEmbed(String(view || ''));
      },
    },
    close: {
      requires: 'view',
      async run(ctx, { view }) {
        return await tool(ctx).closeEmbed(String(view || ''));
      },
    },

    // The dev instance's data, for the agent and the Data view (Phase 4):
    // its documents, its SQL tables (read-only), and seeding them. These
    // reach the visitor's own dev instance only, never a production one.
    docs: {
      requires: 'view',
      async run(ctx, { app, coll }) {
        storeId(ctx, app);
        return await tool(ctx).docs(devId(app, ctx.visitor.id), String(coll || ''));
      },
    },
    doc: {
      requires: 'view',
      async run(ctx, { app, path }) {
        storeId(ctx, app);
        return await tool(ctx).doc(devId(app, ctx.visitor.id), String(path || ''));
      },
    },
    sql: {
      requires: 'view',
      async run(ctx, { app, sql, args }) {
        storeId(ctx, app);
        return await tool(ctx).sql(devId(app, ctx.visitor.id), String(sql || ''), Array.isArray(args) ? args : []);
      },
    },
    seedDocs: {
      requires: 'view',
      async run(ctx, { app, coll, rows, id }) {
        storeId(ctx, app);
        if (!Array.isArray(rows)) ctx.fail('invalid_argument', 'rows must be a list of objects');
        return await tool(ctx).importDocs(devId(app, ctx.visitor.id), String(coll || ''), rows, id ? { id: String(id) } : {});
      },
    },
    seedTable: {
      requires: 'view',
      async run(ctx, { app, table, rows }) {
        storeId(ctx, app);
        if (!Array.isArray(rows)) ctx.fail('invalid_argument', 'rows must be a list of objects');
        return await tool(ctx).importTable(devId(app, ctx.visitor.id), String(table || ''), rows);
      },
    },

    // Publishing (Phase 5). preflight says what moving main to draft would
    // do: the files that change, the migrations that will run on every
    // production instance, what blocks it (a migration that changed or went
    // away after it ran: production instances would refuse the version),
    // the production instances (stores that follow main) and the visitor's
    // dev instance, which should be running this draft. Both trees are read
    // at the snapshots in refs, the ones publish is then given, so a push
    // in between cannot change what was approved; and it only looks: no
    // instance activates because someone opened the dialog.
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
        const dev = await statusOf(ctx, devId(app, ctx.visitor.id), { peek: true });
        return { refs, added, changed, removed, migrations: added.filter(mig), blockers, production, dev: dev ? { n: dev.n, next: dev.next || 0, broken: dev.broken || '' } : null };
      },
    },

    // Move main to snapshot n, only if main is still at ifAt (0: main does
    // not exist yet), so two publishers cannot overwrite each other. The
    // answer's from is where main was: publishing that again rolls back.
    publish: {
      requires: 'view',
      async run(ctx, { app, n, ifAt }) {
        storeId(ctx, app);
        if (typeof n !== 'number' || !(n > 0)) ctx.fail('invalid_argument', 'n is the snapshot to publish');
        if (typeof ifAt !== 'number') ctx.fail('invalid_argument', 'ifAt is where main is now (0 when it does not exist)');
        return await tool(ctx).publish(app, n, { ifAt });
      },
    },

    // Bring an instance up on the version it follows now ("Activate now";
    // otherwise it does on its next view or event).
    activate: {
      requires: 'view',
      async run(ctx, { store }) {
        storeId(ctx, store, 'store');
        const st = await tool(ctx).status(store);
        return { store, n: st.n, broken: st.broken || '' };
      },
    },

    // A new app store, its first files pushed to draft (main does not exist
    // until the first publish).
    create: {
      requires: 'view',
      async run(ctx, { id, type, files }) {
        const w = tool(ctx);
        storeId(ctx, id, 'id');
        if (!Array.isArray(files) || !files.length) ctx.fail('invalid_argument', 'a new app needs files');
        await w.newStore(id, type ? { type: String(type) } : {});
        const res = await w.push(id, files, { ref: 'draft', message: 'created in the bench' });
        return { app: id, n: res.n };
      },
    },
  },
});
