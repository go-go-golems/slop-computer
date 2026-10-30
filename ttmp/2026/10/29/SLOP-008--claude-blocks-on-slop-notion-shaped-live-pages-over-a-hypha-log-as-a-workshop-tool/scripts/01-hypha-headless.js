// SLOP-008 experiment 1: the Hypha kernel without a browser.
//
// Loads hypha.js from a Claude Blocks export, adds the two parser registrations
// that blocks-kit.js makes, plays Blocks' own example workspace (SEED in
// blocks.js) as one peer, and checks what a server-side kernel would need:
//   1. formulas evaluate (welcome.bill, lisbon totals, lisbon_prep.ready);
//   2. the log, stored as Blocks stores it ([id, peer, clock, text, at] rows)
//      and replayed into a fresh kernel in (clock, peer) order, converges;
//   3. a checkpoint restores to the same tree;
//   4. a "turn" (Hypha text from an agent) applies through a Stream as a peer,
//      and a peer limited by `can` globs is refused outside its paths.
//
// Usage: node 01-hypha-headless.js ~/code/others/ramon/claude-blocks
"use strict";
const fs = require("fs"), path = require("path");
const dir = process.argv[2] || path.join(process.env.HOME, "code/others/ramon/claude-blocks");
const H = require(path.join(dir, "hypha.js"));

// blocks-kit.js:11-13, the only parser changes Blocks makes
Object.assign(H.POS, { p: ["text"], bullet: ["text"], numbered: ["text"], todo: ["text"], callout: ["text"], fold: ["title"], columns: [], page: ["of"], toc: [] });
for (const k of ["fold", "columns", "p", "bullet", "numbered", "todo", "callout", "quote"]) H.CONTAINERS.add(k);

// the example workspace: the template literal in `const SEED = () => \`…\`;`
const src = fs.readFileSync(path.join(dir, "blocks.js"), "utf8");
const a = src.indexOf("const SEED = () => `"), b = src.indexOf("`;\nconst Seed = {");
if (a < 0 || b < 0) throw new Error("SEED not found in blocks.js");
const SEED = Function("return `" + src.slice(a + "const SEED = () => `".length, b) + "`")();

const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`); if (!ok) process.exitCode = 1; };

// 1. play the seed as one peer, the way Seed.play(true) does
const K = new H.Kernel();
K.peer({ id: "u1:ex", kind: "agent" });
let t0 = Date.now();
const st = new H.Stream(K, "u1:ex"); st.feed(SEED); const ops = st.end();
const bad = ops.filter(o => !o.ok);
check("seed applies", ops.length > 0 && bad.length === 0, `${ops.length} ops, ${K.cells.size} cells, ${bad.length} rejected, ${Date.now() - t0} ms`);
for (const o of bad.slice(0, 5)) console.log("     rejected:", o.text, "→", o.err);
const pages = K.children("").filter(n => !["desk", "sys", "clock", "spaces", "theme", "fn", "lib", "jobs", "ws"].includes(n));
console.log("     pages:", pages.join(", "));
const v = p => K.valueAt(p);
check("welcome.bill = cups * price", v("welcome.bill") === 13.5, `= ${v("welcome.bill")}`);
check("lisbon.total, per_person", v("lisbon.total") === 1298 && v("lisbon.per_person") === 649, `= ${v("lisbon.total")}, ${v("lisbon.per_person")}`);
const ready = v("lisbon_prep.ready");
check("lisbon_prep.ready reads its own todo blocks", typeof ready === "number", `= ${typeof ready === "number" ? ready.toFixed(3) : ready}`);
check("holes are listed", K.holes().length >= 1, K.holes().map(x => x.path).join(" "));

// a write recomputes the formulas that read it
const w = K.commit("lisbon.days = 12", "u1:you");
check("lisbon.days = 12 recomputes", w.ok && v("lisbon.total") === 2138, `total = ${v("lisbon.total")}, per_person = ${v("lisbon.per_person")}`);

// 2. the log as Blocks stores it, replayed in (clock, peer) order (blocks.js Net.apply)
const rows = K.log.filter(o => o.stmt.k !== "err").map(o => [o.id, o.peer, o.clock, o.text, o.at]);
const json = JSON.stringify({ by: "usr_1", tab: "t1", seq: 0, at: Date.now(), n: rows.length, ops: rows });
const back = JSON.parse(json).ops.map(r => ({ id: r[0], peer: r[1], clock: r[2], text: r[3], at: r[4] }));
back.sort((x, y) => (x.clock - y.clock) || (x.peer < y.peer ? -1 : x.peer > y.peer ? 1 : 0));
const K2 = new H.Kernel(); K2.batch(() => { for (const r of back) K2.receive(r); });
check("replayed log converges", K2.toHypha() === K.toHypha(), `${rows.length} rows, chunk ${json.length} bytes`);

// 3. a checkpoint restores to the same tree
const cp = K.checkpoint(), K3 = new H.Kernel(); K3.restore(cp, "s1");
check("checkpoint restores", K3.toHypha() === K.toHypha() && K3.valueAt("lisbon.total") === 2138, `${cp.ops.length} ops, ${cp.stamps.length} stamps, ${JSON.stringify(cp).length} bytes`);

// 4. a turn, as the chat Claude writes one (blocks.js Net.channel): text through a Stream as a peer
K.peer({ id: "u1:chat", kind: "agent" });
const turn = new H.Stream(K, "u1:chat");
turn.feed('lisbon.ui.9000 is p "Booked: {days} nights, €{per_person} each."\nlisbon.budget = 2500\nnot a line\n');
const tops = turn.end();
check("a turn applies line by line", tops.filter(o => o.ok).length === 2 && tops.filter(o => !o.ok).length === 1,
  tops.map(o => `${o.ok ? "ok" : "rejected"}: ${o.text}${o.ok ? "" : " (" + o.err + ")"}`).join(" | "));

// a hole filler may write only below its hole (blocks.js fillHoles: can = [p, p + ".*"])
const hole = K.holes()[0].path;
K.peer({ id: "u1:f1", kind: "agent", can: [hole, hole + ".*"] });
const fill = new H.Stream(K, "u1:f1");
fill.feed(`${hole}:\n  bullet "**One**: inside the hole"\nwelcome.cups = 99\n`);
const fops = fill.end();
check("a filler is refused outside its hole", fops.some(o => o.ok) && fops.some(o => !o.ok && /welcome\.cups/.test(o.text)),
  fops.map(o => `${o.ok ? "ok" : "refused"}: ${o.text}${o.ok ? "" : " (" + o.err + ")"}`).join(" | "));
check("welcome.cups unchanged", v("welcome.cups") === 3);

// what an agent reads: the workspace as Hypha with block paths
const view = K.toHyphaWithin(120000, "lisbon", { paths: true });
console.log("     toHyphaWithin(120000, lisbon, paths):", view.length, "chars; first lines:");
console.log(view.split("\n").slice(0, 6).map(l => "       " + l).join("\n"));
