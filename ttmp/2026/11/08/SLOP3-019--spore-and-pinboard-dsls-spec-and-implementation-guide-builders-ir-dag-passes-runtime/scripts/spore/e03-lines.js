// E03: where do syntax and runtime errors point? (syntaxLine, lineOf, LINE_OFFSET)
// node e03-lines.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const probe = (label, code) => {
  try { Spore.load(code); console.log(`--- ${label}: built fine`); }
  catch (e) { console.log(`--- ${label}\n${JSON.stringify({ kind: e.kind, line: e.line, message: e.message })}  (program has ${code.split("\n").length} lines)`); }
};
// one error only: a missing ")" on line 2 of 6
probe("missing ) on line 2", `app("a")
  .cell("n", 1
  .cell("m", 2)
  .view(v => v.stat("n"))
// filler
// filler`);
// one error only: a stray token on line 3 of 6
probe("unexpected token on line 3", `app("a")
  .cell("n", 1)
  .cell("m", 2) )
  .view(v => v.stat("n"))
// filler
// filler`);
// unterminated string on line 2 of 5
probe("unterminated string on line 2", `app("a")
  .cell("n", "abc)
  .view(v => v.stat("n"))
// filler
// filler`);
// a missing } on line 2 of 5
probe("missing } in an object on line 2", `app("a")
  .cells({ a: 1, b: 2 )
  .view(v => v.stat("a"))
// filler
// filler`);
// a runtime error in a formula on line 3: the line comes from the stack
{
  const rt = Spore.load(`app("a")
  .cell("n", 1)
  .cell("bad", $ => $.n.foo.bar)
  .view(v => v.stat("n"))`);
  console.log("--- runtime error line", JSON.stringify([...rt.errors.values()].map(e => ({ line: e.line, message: e.message }))));
}
// a cell declared from inside a factory: which line is recorded?
{
  const rt = Spore.load(`const mk = (id) => app(id)
  .cell("n", 1)
  .view(v => v.stat("n"))
mk("x")
mk("y")`);
  console.log("--- factory lines", JSON.stringify(rt.ir().nodes.filter(n => n.kind === "value").map(n => [n.id, n.line]).concat(rt.ir().apps.map(a => [a.id, a.line]))));
}
// cells() records one line for every cell
{
  const rt = Spore.load(`app("c")
  .cells({
    a: 1,
    b: $ => $.a + 1,
  })
  .view(v => v)`);
  console.log("--- cells() lines", JSON.stringify(rt.ir().nodes.filter(n => n.app === "c" && n.kind !== "view").map(n => [n.id, n.line])));
}
