// E08: small leftovers — a failing state step in the IR node; writes visible later in the same action;
// a write to a state from an action; toggle label default; the Program IR with no runtime.
// node e08-misc.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const { Host } = L.internals;
const rt = Spore.load(`app("x")
  .cell("a", 1)
  .cell("twice", $ => $.a * 2)
  .cell("log", [])
  .state("s", 0, ($, s) => { throw new Error("no step") })
  .action("go", $ => { $.set("a", 5); $.set("log", [$.twice]); $.set("s", 42) })
  .view(v => v.toggle("a"))`);
rt.act("x", "go");
const ir = rt.ir();
console.log("--- state node (does it carry error?)", JSON.stringify(ir.nodes.find(n => n.id === "x.s")));
console.log("--- top-level errors", JSON.stringify(ir.errors));
console.log("--- writes apply at once: log after the action (expect [10])", JSON.stringify(rt.cells.get("x.log").value));
console.log("--- toggle label defaults to the cell name", JSON.stringify(ir.apps[0].view));
const p = new Host.Program("empty", null);
console.log("--- Program.ir() before any build", JSON.stringify(p.ir()));
