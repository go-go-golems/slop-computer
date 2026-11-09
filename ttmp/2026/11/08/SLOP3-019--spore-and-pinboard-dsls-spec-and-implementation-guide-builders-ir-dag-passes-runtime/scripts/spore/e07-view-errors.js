// E07: view-lambda errors: not found at LINK, keyed by position, and left behind when hidden.
// node e07-view-errors.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const errs = rt => [...rt.errors.values()].map(e => `${e.key} [${e.kind}] ${e.message.slice(0, 70)}`);
const rt = Spore.load(`app("v")
  .cell("on", true)
  .view(v => v
    .stat("on")
    .when($ => $.on, w => w.text($ => $.nope))
    .list("on", { text: it => it.zzz.y }))`);
console.log("--- after LINK (view lambdas not run yet):", JSON.stringify(errs(rt)));
L.paint(rt, "v");
console.log("--- after a paint with on=true:", JSON.stringify(errs(rt)));
rt.act("v", $ => $.set("on", false));
L.paint(rt, "v");
console.log("--- after a paint with on=false (the text is hidden):", JSON.stringify(errs(rt)));
// list text lambda errors are drawn inline and never recorded
const rt2 = Spore.load(`app("l").cell("xs", [1, 2]).view(v => v.list("xs", { text: it => it.a.b }))`);
L.paint(rt2, "l");
console.log("--- list text lambda throwing:", JSON.stringify(errs(rt2)));
// two button lambdas share one error key
const rt3 = Spore.load(`app("b").cell("n", 1).view(v => v.button("A", $ => $.set("zz", 1)).button("B", $ => $.set("n", 2)))`);
rt3.act("b", $ => $.set("zz", 1));
console.log("--- lambda A failed:", JSON.stringify(errs(rt3)));
rt3.act("b", $ => $.set("n", 2));
console.log("--- then lambda B succeeded:", JSON.stringify(errs(rt3)));
