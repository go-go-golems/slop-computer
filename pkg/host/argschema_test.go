package host

import (
	"strings"
	"testing"
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
