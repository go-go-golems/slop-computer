package host

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

const schemaActor = `
defineActor({ actions: {
  add: {
    requires: 'view',
    args: { type: 'object', required: ['text'], additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 20 }, tags: { type: 'array', items: { type: 'string' } } } },
    result: { type: 'object', properties: { n: { type: 'integer' } } },
    run(ctx, args) { return { n: args.text.length, tags: args.tags || [] } },
  },
  none: {
    requires: 'view',
    args: { type: 'object', properties: { max: { type: 'integer' } } },
    run(ctx, args) { return args },
  },
  loose: { requires: 'view', run(ctx, args) { return args === undefined ? 'undefined' : args } },
} });
`

// Actions that declare an args schema get only arguments of that shape
// (SLOP3-024 phase 2): anything else is invalid_argument, with the place
// it went wrong, before run.
func TestActionArgsSchema(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "sch"})
	h.push(admin, map[string]any{"store": "sch", "files": files(map[string]string{
		"app.json": `{"title":"Schemas","actor":"actor.js"}`,
		"actor.js": schemaActor,
	})})
	call := func(action string, args any) map[string]any {
		return map[string]any{"store": "sch", "action": action, "args": args}
	}
	if got := h.call(admin, "actor.call", call("add", map[string]any{"text": "hello", "tags": []any{"a"}})).(map[string]any); num(got["n"]) != 5 {
		t.Fatalf("add = %v", got)
	}
	for _, c := range []struct {
		args any
		want string
	}{
		{map[string]any{"text": 7}, "at /text: got number, want string"},
		{map[string]any{}, "missing property 'text'"},
		{map[string]any{"text": ""}, "at /text: minLength"},
		{map[string]any{"text": "x", "tags": []any{"a", 2}}, "at /tags/1: got number, want string"},
		{map[string]any{"text": "x", "extra": true}, "additional properties 'extra' not allowed"},
		{42, "got number, want object"},
		{`{"text": 5}`, "at /text: got number, want string"}, // a string is JSON text (the CLI)
	} {
		e := h.fail(admin, "actor.call", call("add", c.args), "invalid_argument")
		if msg, _ := e["message"].(string); !strings.HasPrefix(msg, "add: ") || !strings.Contains(msg, c.want) {
			t.Errorf("add(%v): %q, want %q", c.args, msg, c.want)
		}
	}
	// No arguments: a schema'd action gets {} (and they are checked as {}).
	if got := h.call(admin, "actor.call", map[string]any{"store": "sch", "action": "none"}).(map[string]any); len(got) != 0 {
		t.Fatalf("none() = %v", got)
	}
	// Without a schema nothing changes.
	if got := h.call(admin, "actor.call", map[string]any{"store": "sch", "action": "loose", "args": map[string]any{"any": 1}}).(map[string]any); num(got["any"]) != 1 {
		t.Fatalf("loose = %v", got)
	}

	// A schema that does not compile, or that refers outside itself, breaks
	// the version as a bad requires does.
	for name, actor := range map[string]string{
		"bad":    `defineActor({ actions: { a: { requires: 'view', args: { type: 'object', minProperties: 'two' }, run() {} } } })`,
		"remote": `defineActor({ actions: { a: { requires: 'view', args: { $ref: 'https://example.com/s.json' }, run() {} } } })`,
		"shape":  `defineActor({ actions: { a: { requires: 'view', args: 'object', run() {} } } })`,
	} {
		id := "sch-" + name
		h.call(admin, "store.new", map[string]any{"id": id})
		h.push(admin, map[string]any{"store": id, "files": files(map[string]string{"app.json": `{"title":"x","actor":"actor.js"}`, "actor.js": actor})})
		e := h.fail(admin, "actor.call", map[string]any{"store": id, "action": "a"}, "actor_error")
		if msg, _ := e["message"].(string); !strings.Contains(msg, "action a: args:") {
			t.Errorf("%s: %q", name, msg)
		}
	}
}

// actions.d.ts declares an app's actions from their schemas (SLOP3-024
// phase 2): a page of a JavaScript actor gets typed slop.actions, with no
// contract of its own, and tsc catches a wrong call.
func TestActionsTypes(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "sch"})
	h.push(admin, map[string]any{"store": "sch", "files": files(map[string]string{
		"app.json": `{"title":"Schemas","actor":"actor.js"}`,
		"actor.js": schemaActor,
	})})
	decl := appTypes(h, admin, "sch")
	actions := decl[client.TypesDir+"/actions.d.ts"]
	for _, want := range []string{
		"The actions of sch's actor",
		"add(args: {\n    text: string;\n    tags?: string[];\n  }): {\n    n?: number;\n  };",
		"none(args?: {\n    max?: number;\n  }): unknown;",
		"loose(args?: unknown): unknown;",
	} {
		if !strings.Contains(actions, want) {
			t.Fatalf("actions.d.ts lacks %q:\n%s", want, actions)
		}
	}
	// An instance that does not run the app is refused.
	h.call(admin, "store.new", map[string]any{"id": "other"})
	h.fail(admin, "app.types", map[string]any{"app": "sch", "instance": "other"}, "invalid_argument")

	tsc := tscPath()
	if tsc == "" {
		t.Skip("no tsc: actions.d.ts is not type-checked")
	}
	dir := t.TempDir()
	writeTree(t, dir, decl)
	for name, cfg := range client.Tsconfigs("actor.js", false) {
		writeTree(t, dir, map[string]string{name: string(cfg)})
	}
	page := `const slop = await claude.use('slop')
if (slop) {
  const { n } = await slop.actions.add({ text: 'hi', tags: ['a'] })
  const len: number | undefined = n
  await slop.actions.none()
  await slop.actions.loose({ anything: 1 })
  console.log(len)
}
`
	writeTree(t, dir, map[string]string{"main.ts": page})
	if out, ok := tscCheck(tsc, dir, "tsconfig.json"); !ok {
		t.Fatalf("tsc:\n%s", out)
	}
	writeTree(t, dir, map[string]string{"main.ts": strings.Replace(strings.Replace(page, "{ text: 'hi', tags: ['a'] }", "{ text: 1 }", 1), "slop.actions.none()", "slop.actions.nope()", 1)})
	out, ok := tscCheck(tsc, dir, "tsconfig.json")
	if ok || !strings.Contains(out, "Type 'number' is not assignable to type 'string'") || !strings.Contains(out, "Property 'nope' does not exist") {
		t.Fatalf("tsc on the mistakes:\n%s", out)
	}
	_ = os.Remove(filepath.Join(dir, "main.ts"))
}
