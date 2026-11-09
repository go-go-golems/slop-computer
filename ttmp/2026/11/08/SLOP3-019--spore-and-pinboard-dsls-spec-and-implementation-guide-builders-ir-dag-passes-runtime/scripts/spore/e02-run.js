// E02: RUN semantics, one labelled probe per question.
// node e02-run.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Spore } = L;
const show = (label, v) => console.log(`--- ${label}\n${typeof v === "string" ? v : JSON.stringify(v)}`);
const errs = rt => [...rt.errors.values()].map(({ key, kind, line, where, message }) => ({ key, kind, line, where, message }));
const tryLoad = code => { try { return Spore.load(code); } catch (e) { return { thrown: { name: e.name, kind: e.kind, line: e.line, message: e.message, hint: e.hint } }; } };

// 1. laziness and glitch-freedom on a diamond: a -> b, a -> c, (b, c) -> d
{
  globalThis.__n = { b: 0, c: 0, d: 0 };
  const rt = Spore.load(`app("g")
  .cell("a", 1)
  .cell("b", $ => (__n.b++, $.a + 1))
  .cell("c", $ => (__n.c++, $.a * 2))
  .cell("d", $ => (__n.d++, $.b + $.c))
  .action("bump", $ => $.inc("a"))
  .view(v => v.stat("d"))`);
  show("1a diamond: compute counts after LINK", __n);
  rt.act("g", "bump");
  show("1b after one write, before any read (lazy: expect unchanged counts)", __n);
  show("1c dirty flags after write", { b: rt.cells.get("g.b").dirty, c: rt.cells.get("g.c").dirty, d: rt.cells.get("g.d").dirty });
  show("1d read d", rt.read("g.d", null));
  show("1e counts after reading d once (each recomputes once)", __n);
  // multiple writes in one action: one recompute on the next read
  rt.act("g", $ => { $.inc("a"); $.inc("a"); $.inc("a"); });
  rt.read("g.d", null);
  show("1f counts after an action doing three writes, then one read", __n);
}

// 2. two-phase tick: swap two states
{
  const rt = Spore.load(`app("s").state("a", 1, ($, a) => $.b).state("b", 2, ($, b) => $.a).view(v => v.stat("a"))`);
  rt.tick(1 / 60);
  show("2 swap after one tick (two-phase: expect a=2,b=1)", { a: rt.cells.get("s.a").value, b: rt.cells.get("s.b").value, clock: rt.clock.frame });
}

// 3. cycle: which cells get the error, what order looks like
{
  const rt = Spore.load(`app("c")
  .cell("a", $ => $.b + 1)
  .cell("b", $ => $.a + 1)
  .cell("x", 1)
  .view(v => v.stat("x"))`);
  const ir = rt.ir();
  show("3a cycle errors", errs(rt));
  show("3b cycle node values/errors", ir.nodes.filter(n => n.app === "c").map(n => ({ id: n.id, value: n.value, reads: n.reads, error: n.error })));
  show("3c order (cycle members missing?)", { order: ir.order, nodes: ir.nodes.map(n => n.id) });
}

// 4. dynamic dependencies: reads are re-tracked per compute
{
  const rt = Spore.load(`app("dy")
  .cell("flag", true)
  .cell("a", 1)
  .cell("b", 2)
  .cell("pick", $ => $.flag ? $.a : $.b)
  .view(v => v.stat("pick"))`);
  show("4a reads with flag=true", rt.ir().nodes.find(n => n.id === "dy.pick").reads);
  rt.act("dy", $ => $.set("flag", false));
  show("4b reads with flag=false", rt.ir().nodes.find(n => n.id === "dy.pick").reads);
  show("4c rdeps of dy.a after switch (should not contain dy.pick)", [...(rt.rdeps.get("dy.a") || [])]);
}

// 5. view reads are sticky: a when() branch that once read $.t keeps the program ticking
{
  const rt = Spore.load(`app("vw")
  .cell("live", true)
  .view(v => v.when($ => $.live, w => w.text($ => "t=" + $.t)))`);
  show("5a ticking before any paint", rt.ticking());
  L.paint(rt, "vw");
  show("5b ticking after paint with live=true", rt.ticking());
  rt.act("vw", $ => $.set("live", false));
  L.paint(rt, "vw");
  show("5c ticking after paint with live=false (branch hidden)", rt.ticking());
  show("5d view reads", [...rt.viewReads.get("vw")]);
}

// 6. a state step that mutates prev in place
{
  const rt = Spore.load(`app("m")
  .state("xs", [], ($, xs) => { xs.push(xs.length); return xs })
  .cell("n", $ => $.xs.length)
  .view(v => v.stat("n"))`);
  const seen = []; rt.on(ev => seen.push(ev.type + ":" + ev.id));
  show("6a n after LINK (probeStep ran with a clone)", { xs: rt.cells.get("m.xs").value, n: rt.read("m.n", null) });
  rt.tick(1 / 60); rt.tick(1 / 60);
  show("6b after two ticks: xs, n, change events", { xs: rt.cells.get("m.xs").value, n: rt.read("m.n", null), events: seen });
}

// 7. an action that mutates a read array and sets it back
{
  const rt = Spore.load(`app("al")
  .cell("tasks", ["a"])
  .cell("count", $ => $.tasks.length)
  .action("add", $ => { const t = $.tasks; t.push("b"); $.set("tasks", t) })
  .action("addOk", $ => $.push("tasks", "c"))
  .view(v => v.stat("count"))`);
  const seen = []; rt.on(ev => seen.push(ev.type));
  rt.read("al.count", null);
  rt.act("al", "add");
  show("7a in-place mutation then $.set: tasks, count, events", { tasks: rt.cells.get("al.tasks").value, count: rt.read("al.count", null), events: seen });
  rt.act("al", "addOk");
  show("7b $.push afterwards", { tasks: rt.cells.get("al.tasks").value, count: rt.read("al.count", null), events: seen });
}

// 8. writes from non-actions, and other runtime errors
{
  const rt = Spore.load(`app("w")
  .cell("a", 1)
  .cell("bad", $ => { $.set("a", 2); return 0 })
  .cell("p", $ => Promise.resolve(1))
  .cell("thrower", $ => { throw new TypeError("boom") })
  .cell("down", $ => $.thrower + 1)
  .cell("unknown", $ => $.totl)
  .view(v => v.stat("a"))`);
  show("8 runtime errors after LINK", errs(rt));
  show("8b dependent of a failing formula", { down: rt.read("w.down", null) });
}

// 9. link errors are fatal (thrown by load), cycles are not
{
  show("9a unknown cell in a data slot", tryLoad(`app("a").cell("total", 1).view(v => v.stat("totl"))`).thrown);
  show("9b toggle on a formula", tryLoad(`app("a").cell("f", $ => 1).view(v => v.toggle("f"))`).thrown);
  show("9c button with unknown action", tryLoad(`app("a").action("add", $ => 0).view(v => v.button("x", "ad"))`).thrown);
  show("9d export of an unknown cell", tryLoad(`app("a").cell("n", 1).export("m").view(v => v)`).thrown);
}

// 10. build and syntax errors
{
  show("10a unknown element", tryLoad(`app("a").cell("n", 1)\n  .view(v => v.stats("n"))`).thrown);
  show("10b syntax error", tryLoad(`app("a")\n  .cell("n", 1\n  .view(v => v.stat("n"))\nconst x = ;`).thrown);
  show("10c reserved cell name", tryLoad(`app("a").cell("t", 1)`).thrown);
  show("10d no apps", tryLoad(`const x = 1`).thrown);
  show("10e plain JS error at build", tryLoad(`app("a")\nnull.x`).thrown);
  show("10f duplicate app", tryLoad(`app("a")\napp("a")`).thrown);
}

// 11. $.push / $.toggle / $.inc on desk paths vs $.set (needs a bridge)
{
  const writes = [];
  const bridge = { exists: p => ["trip", "trip.nights"].includes(p), apps: () => ["trip"], children: () => ["nights"], read: () => 4, version: () => "1", write: (p, v) => writes.push([p, v]) };
  const rt = Spore.load(`app("d").cell("x", 1).view(v => v.stat("x"))`, { bridge });
  rt.act("d", $ => $.set("desk.trip.nights", 5));
  rt.act("d", $ => $.inc("desk.trip.nights"));
  rt.act("d", $ => $.push("desk.trip.list", 1));
  rt.act("d", $ => $.toggle("desk.trip.flag"));
  show("11 desk writes that reached the bridge", writes);
  show("11b errors", errs(rt));
}

// 12. param coercion and bounds
{
  const rt = Spore.load(`app("p")
  .param("n", 5, { min: 0, max: 10 })
  .param("on", false)
  .param("mode", "a", { options: ["a", "b"] })
  .param("name", "x")
  .view(v => v.stat("n"))`);
  rt.setParam("p.n", 99); rt.setParam("p.on", "yes"); rt.setParam("p.name", 42);
  let selErr = null; try { rt.setParam("p.mode", "c"); } catch (e) { selErr = e.message; }
  let numErr = null; try { rt.setParam("p.n", "abc"); } catch (e) { numErr = e.message; }
  show("12 coerced values (n out of range kept? on from 'yes'?)", { n: rt.cells.get("p.n").value, on: rt.cells.get("p.on").value, name: rt.cells.get("p.name").value, selErr, numErr });
  const defaults = Spore.load(`app("q").param("a", 0).param("b", 3).param("c", 0.5).param("d", -4).view(v => v)`).params().map(p => [p.id, p.control]);
  show("12b default controls", defaults);
}

// 13. live coding: carry()
{
  const v1 = Spore.load(`app("lc").param("k", 3, { min: 0, max: 9 }).param("j", 1, { min: 0, max: 9 }).cell("v", 10).state("s", 0, ($, s) => s + 1).view(v => v)`);
  v1.setParam("lc.k", 7); v1.setParam("lc.j", 8); v1.tick(0.1); v1.tick(0.1);
  const v2 = Spore.load(`app("lc").param("k", 3, { min: 0, max: 9 }).param("j", 2, { min: 0, max: 9 }).cell("v", 10).state("s", 0, ($, s) => s + 1).view(v => v)`);
  v2.carry(v1);
  show("13 after carry: k kept (same default), j reset (new default), s kept, clock kept", { k: v2.cells.get("lc.k").value, j: v2.cells.get("lc.j").value, s: v2.cells.get("lc.s").value, t: v2.clock.t, frame: v2.clock.frame });
}

// 14. builders are not sealed after BUILD: an action that calls .view() / .action() on a captured app
{
  const rt = tryLoad(`const a = app("open").cell("n", 1)
a.view(v => v.stat("n"))
a.action("grow", $ => { a.view(v => v.stat("n").toggle("n")); a.action("late", $ => $.inc("n")) })`);
  rt.act("open", "grow");
  show("14a view nodes / actions after the runtime call", { views: rt.apps.get("open").views.map(n => n.k + (n.cellId ? ":" + n.cellId : n.of && n.of.id ? ":" + n.of.id : ":UNLINKED")), actions: [...rt.apps.get("open").actions.keys()] });
  let paintErr = null; try { L.paint(rt, "open"); } catch (e) { paintErr = e.message; }
  show("14b painting the late, unlinked nodes", { paintErr, errors: errs(rt) });
}

// 15. component return value, use(), and the group node
{
  const rt = Spore.load(`const kpi = component("kpi", (v, { of, label }) => v.stat(of, label))
app("cp").cell("n", 2)
  .view(v => v.kpi({ of: "n", label: "N" }).use(kpi({ of: "n", label: "again" })))`);
  show("15 view IR with component", rt.ir().apps[0].view);
  show("15b components", rt.ir().components);
}

// 16. $.get with paths, $[name]
{
  const rt = Spore.load(`app("o").cell("x", 1).view(v => v)
app("gg").cell("a", $ => $.get("o.x")).cell("b", $ => $.get("o.x.y.z")).cell("c", $ => $["a"]).view(v => v)`);
  show("16 $.get('o.x'), $.get('o.x.y.z'), $['a']", { a: rt.read("gg.a", null), b: rt.read("gg.b", null), c: rt.read("gg.c", null), errors: errs(rt) });
}

// 17. ticking() and reset()
{
  const still = Spore.load(`app("q").cell("a", 1).cell("b", $ => $.a + 1).view(v => v.stat("b"))`);
  L.paint(still, "q");
  const moving = Spore.load(`app("q").cell("a", $ => $.t * 2).view(v => v.stat("a"))`);
  show("17a ticking: static program, clock formula", { still: still.ticking(), moving: moving.ticking() });
  const s = Spore.load(`app("r").cell("v", 1).param("p", 1, { min: 0, max: 5 }).state("x", 10, ($, x) => x + 1).action("w", $ => { $.set("v", 9); $.set("p", 4) }).view(v => v)`);
  s.tick(0.5); s.tick(0.5); s.act("r", "w"); s.reset();
  show("17b reset(): states and clock back, values/params untouched", { x: s.cells.get("r.x").value, v: s.cells.get("r.v").value, p: s.cells.get("r.p").value, clock: s.clock.t });
}

// 18. a state step throwing, and probeStep at LINK
{
  const rt = Spore.load(`app("st").cell("k", 0).state("x", 1, ($, x) => { if ($.k) throw new Error("step failed"); return x + 1 }).action("arm", $ => $.set("k", 1)).view(v => v)`);
  rt.tick(0.1);
  rt.act("st", "arm"); rt.tick(0.1);
  show("18 state after a failing step keeps its value; error recorded", { x: rt.cells.get("st.x").value, errors: errs(rt) });
}

// 19. pointer: setPointer invalidates readers
{
  const rt = Spore.load(`app("pt").cell("px", $ => $.pointer.x).view(v => v.draw(100, (g, $) => g.circle($.px, 10, 3)))`);
  const a = rt.read("pt.px", null);
  rt.setPointer("pt", { x: 42, y: 1, w: 100, h: 100, over: true, down: false });
  show("19 pointer read before/after setPointer; pointer node in IR", { a, b: rt.read("pt.px", null), pointerNode: rt.ir().nodes.find(n => n.kind === "pointer") });
}

// 20. a cycle that only appears at run time (dynamic deps)
{
  const rt = Spore.load(`app("rc")
  .cell("on", false)
  .cell("a", $ => $.on ? $.b : 1)
  .cell("b", $ => $.a + 1)
  .action("close", $ => $.set("on", true))
  .view(v => v.stat("b"))`);
  show("20a errors before", errs(rt));
  rt.act("rc", "close");
  const b = rt.read("rc.b", null);
  show("20b after the action closes the loop: b, errors", { b, errors: errs(rt) });
}
