// E05: smoke test — every preset builds, links, paints and ticks without errors; IR sizes.
// Also probes plain() (how values are serialised into the IR).
// node e05-presets.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const { PRESETS } = L.internals;
const rows = [];
for (const p of PRESETS) {
  let rt, err = null;
  try { rt = Spore.load(p.code); } catch (e) { rows.push({ id: p.id, buildError: `${e.kind}: ${e.message}` }); continue; }
  L.paintAll(rt);
  for (let i = 0; i < 30; i++) { rt.tick(1 / 60); if (rt.ticking()) L.paintAll(rt); }
  const ir = rt.ir();
  const kinds = {}; for (const n of ir.nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  rows.push({ id: p.id, apps: ir.apps.length, nodes: ir.nodes.length, edges: ir.edges.length, ordered: ir.order.length, kinds, ticking: rt.ticking(), errors: ir.errors.map(e => `${e.kind} ${e.where}: ${e.message}`) });
}
for (const r of rows) console.log(JSON.stringify(r));
// plain(): how the IR serialises values
const { plain } = Spore;
console.log("--- plain()");
console.log(JSON.stringify({
  undef: plain(undefined), nan: plain(NaN), inf: plain(Infinity), date: plain(new Date(0)), fn: plain(x => x + 1),
  long: plain(Array.from({ length: 53 }, (_, i) => i)).slice(-2),
  deep: plain({ a: { b: { c: { d: { e: { f: 1 } } } } } }),
  wide: Object.keys(plain(Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["k" + i, i])))).length,
}));
