// members backend. uses the document db (collection "members")
// TODO: payments are inside each member doc as "paid": {"2025": true, ...}
const db = use('db');

defineActor({
  setup(ctx) {
    // seed once (first run)
    if (!db.collection('members').limit(1).get().empty) return;
    const rows = [
      { name: 'Anna Schmidt', email: 'anna.schmidt@example.org', plot: '12', paid: { '2025': true, '2026': true } },
      { name: 'anna schmidt', email: '', plot: 'Plot 12', paid: { '2026': true } },
      { name: 'Bob Okafor', email: 'bob@example.org', plot: '#3', paid: { '2025': true } },
      { name: 'Carla Diaz', email: 'carla.d@example.org', plot: '7', paid: {} },
      { name: 'Carla  Diaz', email: 'carla.d@example.org', plot: 'plot 7', paid: { '2025': true } },
      { name: 'Dev Patel', email: '', plot: '21', paid: { '2026': true } },
      { name: 'Eve Martin', email: 'eve.m@example.org', plot: 'Plot 4', paid: { '2024': true } },
      { name: 'Frank Liu', email: 'frank@example.org', plot: '15', paid: { '2025': true, '2026': true } },
      { name: 'frank liu', email: 'Frank@Example.org', plot: '#15', paid: {} },
      { name: 'Gita Rao', email: 'gita.rao@example.org', plot: '9', paid: { '2026': true } },
      { name: 'Hans Becker', email: 'hans@example.org', plot: '2', paid: { '2025': true } },
      { name: 'Ines Costa', email: '', plot: 'Plot 18', paid: {} },
    ];
    rows.forEach((r, i) => db.doc('members/m' + (i + 1)).set(r));
  },
  actions: {
    list: { requires: 'view', run() { return db.collection('members').get().docs.map((d) => ({ id: d.id, body: d.data() })); } },
    add: { requires: 'interact', run(ctx, m) { const id = 'm' + Date.now(); db.doc('members/' + id).set(m); return id; } },
    update: { requires: 'interact', run(ctx, a) { db.doc('members/' + a.id).set(a.data); return 'ok'; } },
    remove: { requires: 'interact', run(ctx, a) { db.doc('members/' + a.id).delete(); return 'ok'; } },
  },
});
