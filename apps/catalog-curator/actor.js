// SLOP3-015 view 15: the curator's actor. "today" chooses the apps of the
// day with the model once per day and keeps them in picks/<day> for
// everyone. The first member to ask pays for that one call (the turn's
// visitor is the payer); everyone after reads the stored picks.
//
// SLOP3-018: the catalog is catalog-data's, read through the binding
// "catalog" (bind.set catalog-curator catalog catalog-data, and
// grant.set catalog-data store:catalog-curator view). The page reads it
// through the "catalog" action: it runs on its own sandbox origin, which
// catalog-data's routes do not serve.
const db = use('db'), sample = use('sample'), stores = use('stores');
const curate = require('./curate.js');

const readCatalog = () => stores.open('catalog').call('catalog', {}); // a promise; the turn ends at its await

defineActor({
  actions: {
    catalog: { requires: 'view', run: () => readCatalog() },
    today: {
      requires: 'interact',
      async run(ctx) {
        const day = new Date(ctx.now).toISOString().slice(0, 10);
        const ref = db.doc('picks/' + day);
        const have = ref.get();
        if (have.exists) return have.data();
        if (!sample || !sample.allowed()) ctx.fail('permission_denied', 'the model is not available to you');
        const catalog = await readCatalog();
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
