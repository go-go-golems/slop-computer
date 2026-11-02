// The Workshop (SLOP3-002): review a store's snapshots in an inspect
// preview, comment on elements, let an agent answer with a new draft, and
// publish by moving main. Threads are documents in this store; every
// change goes through an action. The workshop module reads and publishes
// as the visiting person. Install:
//   slop push apps/workshop --store workshop
//   slop app trust workshop workshop
//   slop mount set <live host> /workshop workshop
const ws = use('workshop');
const db = use('db');

function tool(ctx) {
  if (!ws) ctx.fail('unavailable', 'this app is not trusted with the workshop module (slop app trust <store> workshop)');
  return ws;
}
const text = (s, max) => String(s == null ? '' : s).trim().slice(0, max);
const newId = () => 'th_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function thread(ctx, id) {
  const d = db.doc('threads/' + text(id, 40)).get();
  if (!d.exists) ctx.fail('not_found', 'no thread ' + id);
  return d.data();
}

function author(ctx, agent) {
  return { by: ctx.visitor.id, name: ctx.visitor.name || '', agent: !!agent, at: Date.now() };
}

defineActor({
  actions: {
    // The stores the visitor can review, with their refs and open threads.
    overview: {
      requires: 'view',
      async run(ctx) {
        const w = tool(ctx);
        const open = {};
        for (const d of db.collection('threads').where('status', '==', 'open').get().docs) {
          const t = d.data();
          open[t.store] = (open[t.store] || 0) + 1;
        }
        const list = (await w.stores({ all: ctx.visitor.audience === 'admin' })).filter((s) => s.id !== ctx.store.id);
        const refs = await Promise.all(list.map((s) => w.refs(s.id).catch(() => ({}))));
        return list.map((s, i) => ({ id: s.id, app: s.app || '', type: s.type || '', refs: refs[i], open: open[s.id] || 0 }))
          .filter((s) => s.refs.main || s.refs.draft);
      },
    },

    store: {
      requires: 'view',
      async run(ctx, { store }) {
        const w = tool(ctx);
        const [snapshots, refs] = await Promise.all([w.snapshots(store), w.refs(store)]);
        return { store, snapshots: snapshots.slice(0, 30), refs };
      },
    },

    preview: {
      requires: 'view',
      async run(ctx, { store, n, parent }) {
        return await tool(ctx).preview(store, String(n), parent);
      },
    },

    files: {
      requires: 'view',
      async run(ctx, { store, n }) {
        return await tool(ctx).files(store, String(n));
      },
    },

    // A text file's content, or {data, …} (base64) for a binary one.
    read: {
      requires: 'view',
      async run(ctx, { store, n, path }) {
        return await tool(ctx).read(store, String(n), path);
      },
    },

    // Push files onto snapshot n: put adds or replaces files ({path, text}
    // or {path, data} in base64), remove deletes paths, replace makes put
    // the whole tree (a folder push). The rest of the tree is kept by hash.
    // The result is a new snapshot on draft; main, which visitors see, does
    // not move until someone publishes.
    push: {
      requires: 'admin',
      async run(ctx, { store, n, put, remove, replace, message }) {
        const w = tool(ctx);
        const clean = (p) => {
          const q = text(p, 300).replace(/^\/+/, '');
          if (!q || q.split('/').some((s) => s === '..' || s === '')) ctx.fail('invalid_argument', 'a file path in the tree, like index.html or css/site.css');
          return q;
        };
        const files = (Array.isArray(put) ? put : []).map((f) => (f.data != null
          ? { path: clean(f.path), data: String(f.data) }
          : { path: clean(f.path), text: String(f.text == null ? '' : f.text) }));
        const gone = new Set([...(Array.isArray(remove) ? remove : []).map(clean), ...files.map((f) => f.path)]);
        const kept = replace ? [] : (await w.files(store, String(n)))
          .filter((f) => !gone.has(f.path))
          .map((f) => ({ path: f.path, sha256: f.sha256, size: f.size, type: f.type }));
        if (!files.length && !(Array.isArray(remove) && remove.length)) ctx.fail('invalid_argument', 'nothing to push');
        const what = replace ? 'a folder' : [...files.map((f) => f.path), ...(remove || []).map((p) => '−' + p)].slice(0, 4).join(', ');
        return await w.push(store, [...kept, ...files], { message: text(message, 200) || `${what} (onto #${n})` });
      },
    },

    comment: {
      requires: 'interact',
      run(ctx, { store, n, anchor, text: body }) {
        const a = anchor || {};
        const id = newId();
        const now = Date.now();
        db.doc('threads/' + id).set({
          store: text(store, 80), n: Number(n) || 0, status: 'open',
          anchor: { selector: text(a.selector, 400), tag: text(a.tag, 20), text: text(a.text, 120),
            fx: Number(a.fx) || 0, fy: Number(a.fy) || 0, box: Array.isArray(a.box) ? a.box.slice(0, 4).map(Number) : [] },
          comments: [{ ...author(ctx, false), text: text(body, 4000), n: Number(n) || 0 }],
          createdAt: now, updatedAt: now,
        });
        return { id };
      },
    },

    // An agent answers with the snapshot that addresses the thread.
    reply: {
      requires: 'interact',
      run(ctx, { thread: id, text: body, n, agent }) {
        const t = thread(ctx, id);
        t.comments.push({ ...author(ctx, agent), text: text(body, 4000), n: Number(n) || t.n });
        t.updatedAt = Date.now();
        db.doc('threads/' + id).set(t);
        return { id, comments: t.comments.length };
      },
    },

    resolve: {
      requires: 'interact',
      run(ctx, { thread: id, open }) {
        const t = thread(ctx, id);
        t.status = open ? 'open' : 'resolved';
        t.updatedAt = Date.now();
        db.doc('threads/' + id).set(t);
        return { id, status: t.status };
      },
    },

    publish: {
      requires: 'admin',
      async run(ctx, { store, n }) {
        const out = await tool(ctx).publish(store, Number(n));
        for (const d of db.collection('threads').where('store', '==', store).get().docs) {
          const t = d.data();
          if (t.status !== 'open') continue;
          t.comments.push({ ...author(ctx, false), text: 'published #' + n, n: Number(n), system: true });
          t.updatedAt = Date.now();
          db.doc(d.path).set(t);
        }
        return out;
      },
    },

    follow: {
      requires: 'admin',
      async run(ctx, { store, ref }) {
        return await tool(ctx).follow(store, ref);
      },
    },
  },
});
