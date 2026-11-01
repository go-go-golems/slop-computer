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
    async overview(ctx) {
      ctx.need('view');
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

    async store(ctx, { store }) {
      ctx.need('view');
      const w = tool(ctx);
      const [snapshots, refs] = await Promise.all([w.snapshots(store), w.refs(store)]);
      return { store, snapshots: snapshots.slice(0, 30), refs };
    },

    async preview(ctx, { store, n, parent }) {
      ctx.need('view');
      return await tool(ctx).preview(store, String(n), parent);
    },

    comment(ctx, { store, n, anchor, text: body }) {
      ctx.need('interact');
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

    // An agent answers with the snapshot that addresses the thread.
    reply(ctx, { thread: id, text: body, n, agent }) {
      ctx.need('interact');
      const t = thread(ctx, id);
      t.comments.push({ ...author(ctx, agent), text: text(body, 4000), n: Number(n) || t.n });
      t.updatedAt = Date.now();
      db.doc('threads/' + id).set(t);
      return { id, comments: t.comments.length };
    },

    resolve(ctx, { thread: id, open }) {
      ctx.need('interact');
      const t = thread(ctx, id);
      t.status = open ? 'open' : 'resolved';
      t.updatedAt = Date.now();
      db.doc('threads/' + id).set(t);
      return { id, status: t.status };
    },

    async publish(ctx, { store, n }) {
      ctx.need('admin');
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

    async follow(ctx, { store, ref }) {
      ctx.need('admin');
      return await tool(ctx).follow(store, ref);
    },
  },
});
