// E06: IR.order drops nodes when states read each other (a legal two-phase loop).
// node e06-order.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const { PRESETS } = L.internals;
for (const id of ["wild", "home"]) {
  const rt = Spore.load(PRESETS.find(p => p.id === id).code);
  L.paintAll(rt);
  const ir = rt.ir();
  const missing = ir.nodes.map(n => n.id).filter(x => !ir.order.includes(x));
  console.log(`--- ${id}: ${ir.order.length}/${ir.nodes.length} nodes in order; missing:`, JSON.stringify(missing));
  const stateEdges = ir.edges.filter(e => ir.nodes.find(n => n.id === e.to && n.kind === "state"));
  console.log(`    edges into states:`, JSON.stringify(stateEdges.map(e => e.from + "→" + e.to)));
}
// the minimal case: two states that read each other, and a view
const rt = Spore.load(`app("m").state("a", 1, ($, a) => $.b).state("b", 2, ($, b) => $.a).cell("sum", $ => $.a + $.b).view(v => v.stat("sum"))`);
L.paint(rt, "m");
const ir = rt.ir();
console.log("--- minimal: order", JSON.stringify(ir.order), "errors", JSON.stringify(ir.errors));
