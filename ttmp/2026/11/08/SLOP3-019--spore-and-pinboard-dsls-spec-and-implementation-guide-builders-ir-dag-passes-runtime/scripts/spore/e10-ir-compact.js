// E10: the IR of a small program after LINK, one paint and one tick, printed one item per line.
// node e10-ir-compact.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
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
  .view(v => v.stat("total"))`;
const rt = L.Spore.load(code);
L.paintAll(rt);
rt.tick(0.5);
const ir = rt.ir();
const out = ["{"];
const keys = Object.keys(ir);
keys.forEach((k, i) => {
  const v = ir[k], comma = i < keys.length - 1 ? "," : "";
  if (Array.isArray(v) && v.length && typeof v[0] === "object") {
    out.push(`  "${k}": [`);
    v.forEach((x, j) => out.push("    " + JSON.stringify(x) + (j < v.length - 1 ? "," : "")));
    out.push("  ]" + comma);
  } else out.push(`  "${k}": ${JSON.stringify(v)}${comma}`);
});
out.push("}");
console.log(out.join("\n"));
JSON.parse(out.join("\n"));
