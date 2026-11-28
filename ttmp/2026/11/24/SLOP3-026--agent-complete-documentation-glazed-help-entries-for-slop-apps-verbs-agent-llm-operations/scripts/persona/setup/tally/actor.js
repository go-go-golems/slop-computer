// Tally: a counter per name. No page; used from scripts.
const db = use('db');
defineActor({
  actions: {
    add: {
      requires: 'interact',
      run(ctx, { name, by }) {
        name = String(name || '').trim();
        if (!name) ctx.fail('invalid_argument', 'add needs a name');
        const ref = db.doc('counts/' + name);
        const n = ((ref.get().data() || {}).n || 0) + (Number(by) || 1);
        ref.set({ n, at: ctx.now });
        return { name, n };
      },
    },
    ls: {
      requires: 'view',
      run() {
        return db.collection('counts').get().docs.map((d) => ({ name: d.id, n: d.data().n }));
      },
    },
  },
});
