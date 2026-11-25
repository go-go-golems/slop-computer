// actor.js: one instance per store, one event at a time.
const db = use('db'), sample = use('sample');   // sample is null unless the policy allows it

defineActor({
  actions: {
    // requires is checked by the kernel before the action runs; an action
    // that declares none needs admin.
    sign: {
      requires: 'interact',                     // guests may sign when the store grants @guest interact
      run(ctx, { text }) {
        text = String(text || '').trim().slice(0, 500);
        if (!text) ctx.fail('invalid_argument', 'empty entry');
        const id = 'e' + ctx.now.toString(36);
        db.doc('entries/' + id).set({ text, by: ctx.visitor.id, guest: ctx.visitor.guest, at: ctx.now });
        return { id };
      },
    },
    reply: {
      requires: 'interact',
      async run(ctx, { id }) {                  // an await ends the turn
        if (!sample || !sample.allowed()) ctx.fail('permission_denied', 'no LLM for you');
        const e = db.doc('entries/' + id).get().data();
        const r = await sample('Reply kindly, in one line: ' + e.text);
        db.doc('entries/' + id).update({ reply: r.text });   // a new turn
      },
    },
  },
});
