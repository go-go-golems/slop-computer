package host

import (
	"regexp"
	"strings"
	"testing"
)

const tsActor = `import { Batch, type Change } from './lib/rows.ts'
import { twice } from './lib/util'
import * as yaml from 'yaml'
const tiny = require('tiny')

interface Args { items?: Change[] }

const def = defineActor({
  actions: {
    count: { requires: 'view', run(ctx: unknown, args: Args): number { return new Batch(9, args.items ?? []).check() } },
    tooMany(ctx: unknown, args: Args) { return new Batch(1, args.items ?? []).check() },
    where(): string { return new Error('here').stack ?? '' },
    double(ctx: unknown, args: { n: number }) { return { util: twice(args.n), vendored: tiny.twice(args.n), yaml: yaml.stringify({ a: 1 }).trim() } },
  },
})
export const actions = Object.keys(def.actions)
`

const tsRows = `export interface Change { path: string; text?: string }
export class Batch {
  constructor(private readonly limit: number, public items: Change[] = []) {}
  check(): number {
    const over = this.items.length - this.limit
    if (over > 0) throw new Error('too many changes: ' + over)
    return this.items.length
  }
}
`

// SLOP3-024 phase 0: an actor written in TypeScript. Its entry and the
// files it requires compile (with or without the extension in the import),
// bridged modules and vendored bundles (slop.imports.actor) resolve, stack
// traces point at the .ts lines, and a version that does not compile is
// refused with the position.
func TestTypeScriptActor(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	app := map[string]string{
		"app.json":        `{"title":"TS actor","actor":"actor.ts","type":"tsactor","slop":{"imports":{"actor":{"tiny":"vendor/tiny.cjs"}}}}`,
		"actor.ts":        tsActor,
		"lib/rows.ts":     tsRows,
		"lib/util.ts":     "export const twice = (n: number): number => n * 2\n",
		"vendor/tiny.cjs": "module.exports = { twice: function (n) { return 2 * n } }\n",
		"index.html":      "<!doctype html><title>t</title>",
	}
	h.call(admin, "store.new", map[string]any{"id": "tsactor"})
	h.call(admin, "files.push", map[string]any{"store": "tsactor", "files": files(app)})
	if st := h.call(admin, "app.status", map[string]any{"store": "tsactor"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	call := func(action string, args map[string]any) any {
		return h.call(admin, "actor.call", map[string]any{"store": "tsactor", "action": action, "args": args})
	}
	two := []any{map[string]any{"path": "a"}, map[string]any{"path": "b"}}
	if n := call("count", map[string]any{"items": two}); n != 2.0 {
		t.Fatalf("count = %v", n)
	}
	d := call("double", map[string]any{"n": 21}).(map[string]any)
	if d["util"] != 42.0 || d["vendored"] != 42.0 || d["yaml"] != "a: 1" {
		t.Fatalf("double = %v", d)
	}
	if s := call("where", nil).(string); !regexp.MustCompile(`at where \(actor\.ts:12:\d+`).MatchString(s) {
		t.Fatalf("the stack does not point at actor.ts line 12:\n%s", s)
	}
	e := h.fail(admin, "actor.call", map[string]any{"store": "tsactor", "action": "tooMany", "args": map[string]any{"items": two}}, "actor_error")
	if msg, _ := e["message"].(string); !strings.Contains(msg, "too many changes: 1") {
		t.Fatalf("tooMany = %v", e)
	}

	// A version that does not compile is refused; the app stays on the last one.
	app["lib/rows.ts"] = strings.Replace(tsRows, "check(): number {", "check(): number {{", 1)
	h.call(admin, "files.push", map[string]any{"store": "tsactor", "files": files(app)})
	st := h.call(admin, "app.status", map[string]any{"store": "tsactor"}).(map[string]any)
	if broken, _ := st["broken"].(string); st["n"] != 1.0 || !strings.Contains(broken, "SyntaxError: lib/rows.ts:10:1: Expected identifier but found end of file") || strings.Contains(broken, "GoError") {
		t.Fatalf("status after a broken push = %v", st)
	}
}

// slop eval runs a TypeScript program when asked (ts: true); one that does
// not compile fails with the position.
func TestTypeScriptEval(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	res := h.call(admin, "eval", map[string]any{"ts": true, "source": "interface P { n: number }\nconst p: P = { n: 21 }\nreturn p.n * 2 as number"}).(map[string]any)
	if res["result"] != 42.0 {
		t.Fatalf("eval = %v", res)
	}
	e := h.fail(admin, "eval", map[string]any{"ts": true, "source": "const n: number = \nreturn n"}, "eval_error")
	if msg, _ := e["message"].(string); !strings.Contains(msg, "eval.ts:2:1: ") {
		t.Fatalf("a program that does not compile: %v", e)
	}
	// Without ts, TypeScript is a syntax error, as before.
	h.fail(admin, "eval", map[string]any{"source": "const n: number = 1\nreturn n"}, "eval_error")
}
