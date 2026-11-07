// SLOP3-015 view 15: the curator's actor. One action, today: the apps of
// the day, chosen by the model once per day and kept in picks/<day> for
// everyone. The first member to ask pays for that one call (the turn's
// visitor is the payer); everyone after reads the stored picks.
const db = use('db'), sample = use('sample');
const catalog = require('./data/catalog.json');
const curate = require('./curate.js');

defineActor({
  actions: {
    today: {
      requires: 'interact',
      async run(ctx) {
        const day = new Date(ctx.now).toISOString().slice(0, 10);
        const ref = db.doc('picks/' + day);
        const have = ref.get();
        if (have.exists) return have.data();
        if (!sample || !sample.allowed()) ctx.fail('permission_denied', 'the model is not available to you');
        const ask = 'Three apps of the day: varied (not all games, not all tools), each worth opening today, at least two of them free.';
        const r = await sample(curate.Curate.prompt(catalog, ask, 3), { modelTier: 'quick' }); // the turn ends here
        const got = curate.Curate.parse(r.text, catalog);
        const doc = got
          ? { day, picks: got.picks.slice(0, 3), note: got.note, model: r.model || '', by: 'model', at: ctx.now }
          : { day, picks: curate.Curate.seeded(catalog, day, 3), note: '', model: r.model || '', by: 'seed', at: ctx.now };
        const again = ref.get(); // a new turn: someone may have been first
        if (again.exists) return again.data();
        ref.set(doc);
        return doc;
      },
    },
  },
});
