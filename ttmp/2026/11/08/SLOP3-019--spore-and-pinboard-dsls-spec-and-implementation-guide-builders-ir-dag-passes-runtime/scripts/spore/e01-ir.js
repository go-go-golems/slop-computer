// E01: build + link a small two-app program and print Runtime.ir(), before and after one paint.
// node e01-ir.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const code = `app("trip", { title: "Trip" })
  .param("nights", 4, { min: 1, max: 14 })
  .cell("rate", 120)
  .cell("stay", $ => $.nights * $.rate)
  .cell("total", $ => $.stay + $.food.total)
  .state("days", 0, ($, d) => d + $.dt)
  .action("more", $ => $.inc("nights"))
  .view(v => v
    .stat("total", "Total", { unit: "€" })
    .row(r => r.stat("stay", "Stay").stat("food.total", "Food"))
    .button("One more night", "more")
    .when($ => $.nights > 5, w => w.note($ => \`\${$.nights} nights\`)))

app("food")
  .param("perDay", 45, { min: 10, max: 150 })
  .cell("total", $ => $.perDay * $.trip.nights)
  .view(v => v.stat("total"))
`;
const rt = Spore.load(code);
const before = rt.ir();
console.log("=== IR right after load (BUILD + LINK, no paint) ===");
console.log(JSON.stringify(before, null, 2));
L.paintAll(rt);
const after = rt.ir();
console.log("=== view nodes after one paint ===");
console.log(JSON.stringify(after.nodes.filter(n => n.kind === "view"), null, 2));
console.log("=== order after paint ===");
console.log(JSON.stringify(after.order));
console.log("ticking:", rt.ticking());
