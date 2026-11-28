// The event's task list: members tick tasks off; admins add them.
const db = use('db');
defineActor({
  actions: {
    add: { requires: 'admin', run(ctx, { title }) {
      const id = 't' + ctx.now.toString(36);
      db.doc('tasks/' + id).set({ id, title: String(title || '').slice(0, 200), done: false });
      return { id };
    } },
    toggle: { requires: 'interact', run(ctx, { id }) {
      const d = db.doc('tasks/' + id);
      const t = d.get().data();
      if (!t) ctx.fail('not_found', 'no task ' + id);
      d.update({ done: !t.done });
      return { done: !t.done };
    } },
  },
});
