//go:build ignore

// SLOP-008 experiment 2: the Hypha kernel inside Go, through goja.
//
// The question: can the slop server (or the slop CLI) hold a workspace's
// kernel without a browser, to print a workspace, apply an agent's turn, and
// read cell values? hypha.js has no DOM dependency (experiment 1 runs it in
// Node); this checks that goja runs it, and how fast.
//
// Run from a scratch module (this file is not part of the slop module):
//
//	mkdir /tmp/hg && cp 02-hypha-goja.go /tmp/hg/main.go && cd /tmp/hg
//	go mod init hg && go get github.com/dop251/goja@v0.0.0-20251103141225-af2ceb9156d7
//	go run . ~/code/others/ramon/claude-blocks
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/dop251/goja"
)

// driver runs inside goja after hypha.js. It returns one line per check.
const driver = `
(function (SEED) {
  const H = globalThis.Hypha, out = [];
  const check = (name, ok, detail) => out.push((ok ? "ok   " : "FAIL ") + name + (detail ? "  " + detail : ""));
  Object.assign(H.POS, { p: ["text"], bullet: ["text"], numbered: ["text"], todo: ["text"], callout: ["text"], fold: ["title"], columns: [], page: ["of"], toc: [] });
  for (const k of ["fold", "columns", "p", "bullet", "numbered", "todo", "callout", "quote"]) H.CONTAINERS.add(k);

  const K = new H.Kernel(); K.peer({ id: "u1:ex", kind: "agent" });
  const st = new H.Stream(K, "u1:ex"); st.feed(SEED); const ops = st.end();
  check("seed applies", ops.length > 0 && ops.every(o => o.ok), ops.length + " ops, " + K.cells.size + " cells");
  check("lisbon.total, per_person", K.valueAt("lisbon.total") === 1298 && K.valueAt("lisbon.per_person") === 649,
    "= " + K.valueAt("lisbon.total") + ", " + K.valueAt("lisbon.per_person"));
  K.commit("lisbon.days = 12", "u1:you");
  check("a write recomputes", K.valueAt("lisbon.total") === 2138, "total = " + K.valueAt("lisbon.total"));

  const turn = new H.Stream(K, "u1:chat");
  turn.feed('lisbon.ui.9000 is p "Booked: {days} nights."\nnot a line\n');
  const t = turn.end();
  check("a turn applies, a bad line is rejected", t[0].ok && !t[1].ok, t.map(o => (o.ok ? "ok: " : "rejected: ") + o.text).join(" | "));

  const rows = K.log.filter(o => o.stmt.k !== "err").map(o => ({ id: o.id, peer: o.peer, clock: o.clock, text: o.text, at: o.at }));
  const K2 = new H.Kernel(); K2.batch(() => { for (const r of rows) K2.receive(r); });
  check("replayed log converges", K2.toHypha() === K.toHypha(), rows.length + " rows");

  const cp = K.checkpoint(), K3 = new H.Kernel(); K3.restore(cp, "s1");
  check("checkpoint restores", K3.toHypha() === K.toHypha(), cp.ops.length + " ops");

  // a log the size of a busy workspace: 5,000 writes that each recompute formulas
  const big = []; let clock = K.clock;
  for (let i = 0; i < 5000; i++) big.push({ id: "b" + i, peer: "u2:you", clock: ++clock, text: "lisbon.days = " + (2 + i % 12), at: 0 });
  const t0 = Date.now(); K.batch(() => { for (const r of big) K.receive(r); });
  check("5,000 ops replay", K.valueAt("lisbon.days") === 2 + 4999 % 12, (Date.now() - t0) + " ms");
  return out.join("\n") + "\n" + "toHypha: " + K.toHypha().length + " chars";
})
`

func main() {
	dir := filepath.Join(os.Getenv("HOME"), "code/others/ramon/claude-blocks")
	if len(os.Args) > 1 {
		dir = os.Args[1]
	}
	hypha, err := os.ReadFile(filepath.Join(dir, "hypha.js"))
	if err != nil {
		panic(err)
	}
	blocks, err := os.ReadFile(filepath.Join(dir, "blocks.js"))
	if err != nil {
		panic(err)
	}
	src := string(blocks)
	a := strings.Index(src, "const SEED = () => `")
	b := strings.Index(src, "`;\nconst Seed = {")
	if a < 0 || b < 0 {
		panic("SEED not found in blocks.js")
	}
	seedLiteral := "`" + src[a+len("const SEED = () => `"):b] + "`"

	start := time.Now()
	vm := goja.New()
	console := vm.NewObject()
	_ = console.Set("log", func(args ...any) { fmt.Println(args...) })
	_ = console.Set("error", func(args ...any) { fmt.Println(append([]any{"console.error:"}, args...)...) })
	_ = vm.Set("console", console)
	if _, err := vm.RunScript("hypha.js", string(hypha)); err != nil {
		panic(err)
	}
	loaded := time.Since(start)
	seed, err := vm.RunString(seedLiteral)
	if err != nil {
		panic(err)
	}
	fn, err := vm.RunString(driver)
	if err != nil {
		panic(err)
	}
	run, _ := goja.AssertFunction(fn)
	res, err := run(goja.Undefined(), seed)
	if err != nil {
		panic(err)
	}
	fmt.Println(res.String())
	fmt.Printf("hypha.js loaded in %s; total %s\n", loaded.Round(time.Millisecond), time.Since(start).Round(time.Millisecond))
}
