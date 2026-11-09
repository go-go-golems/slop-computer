// E04: the HOST layer without a DOM: Program, window.spore, the desk Bridge on a real
// Hypha Kernel, export(), syncDesk, and the frame Loop (driven by a manual rAF).
// node e04-host.js <spore.js> <hypha.js> <index.html>
const L = require(__dirname + "/load.js")(process.argv[2], process.argv[3], process.argv[4]);
const { Host } = L.internals;
const H = globalThis.Hypha;
const show = (label, v) => console.log(`--- ${label}\n${typeof v === "string" ? v : JSON.stringify(v)}`);

// a real Hypha kernel standing in for the CC5 desk
const K = new H.Kernel();
const feed = (text, peer = "me") => { if (!K.peers.has(peer)) K.peer({ id: peer, kind: "human" }); const s = new H.Stream(K, peer); s.feed(text + "\n"); return s.end(); };
feed(`trip:\n  nights = 4\n  total = nights * 100`);
const X = {
  K: () => K, past: () => false, readonly: () => false, sample: () => null,
  writeText: text => feed(text, "me"),
  write: (text, role) => feed(text, "me:" + (role || "clock")),
};
L.CC5Spore.init(X);
show("init: window.cc5?.spore set?", { cc5: !!(globalThis.cc5 && globalThis.cc5.spore) });

// a program keyed like a CC5 code cell: lab.code
const p = new Host.Program("lab.code", "lab.code");
Host.Registry.set("lab.code", p);
const api = L.api;
api.use("lab.code");
const code = `app("words")
  .param("k", 2, { min: 0, max: 10 })
  .cell("nights", $ => $.desk.trip.nights)
  .cell("total", $ => $.desk.trip.total * $.k)
  .cell("missing", $ => $.desk.nope.x)
  .action("more", $ => $.set("desk.trip.nights", $.desk.trip.nights + 1))
  .export("total", "nights")
  .view(v => v.stat("total"))`;
show("api.load", api.load(code));
const ir = api.getIR();
show("IR source + desk nodes + errors", { source: ir.source, desk: ir.nodes.filter(n => n.kind === "desk"), errors: ir.errors });
show("api.get('words.total')", api.get("words.total"));
show("api.setParam returns the value it took", api.setParam("words.k", 3));
show("api.act('words.more') → errors", api.act("words.more"));
show("desk after the action: trip.nights / trip.total", { nights: K.valueAt("trip.nights"), total: K.valueAt("trip.total") });
show("before syncDesk: words.nights (stale?)", { nights: p.rt.read("words.nights", null), dirty: p.rt.cells.get("words.nights").dirty });
const changed = p.rt.syncDesk();
show("after syncDesk", { changed, nights: p.rt.read("words.nights", null), total: p.rt.read("words.total", null) });
show("bridge version string", Host.Program && X.K().log.length);

// export(): writes lab.out.words.<cell> (throttled to every 2 s)
p.exportTick(10000);
show("after exportTick(10000): lab.out.words", K.valueAt("lab.out.words"));
api.setParam("words.k", 5);
p.exportTick(11000);
show("exportTick 1 s later is throttled: lab.out.words.total", K.valueAt("lab.out.words.total"));
p.exportTick(12500);
show("exportTick 2.5 s later: lab.out.words.total", K.valueAt("lab.out.words.total"));

// a build error keeps the last runtime and annotates the IR
const bad = api.load(`app("words").cell("n", ) )`);
show("api.load(broken) result", { ok: bad.ok, errors: bad.errors.map(e => ({ kind: e.kind, line: e.line, message: e.message })) });
const ir2 = api.getIR();
show("IR after a broken load: buildError, note, still has old apps?", { buildError: ir2.buildError && ir2.buildError.kind, note: ir2.note, apps: ir2.apps.map(a => a.id) });

// the frame Loop: a fake live view; dt clamps; ticking() gates rt.tick
api.load(`app("sim").state("x", 0, ($, x) => x + $.dt).view(v => v.stat("x"))`);
const fakeView = { prog: p, alive: () => true, frames: 0, frame() { this.frames++; } };
Host.Loop.views.add(fakeView);
globalThis.raf.flush(1000);   // first frame: dt = 1/60
globalThis.raf.flush(1016);
globalThis.raf.flush(3016);   // 2 s gap: dt clamps to 0.1
show("Loop: x after frames at t=1000, 1016, 3016 ms (1/60 + 0.016 + 0.1)", { x: p.rt.cells.get("sim.x").value, frame: p.rt.clock.frame, viewFrames: fakeView.frames });
api.play(false);
globalThis.raf.flush(3032);
show("Loop while paused: x unchanged, view still framed", { x: p.rt.cells.get("sim.x").value, viewFrames: fakeView.frames });
show("programs()", api.programs());
