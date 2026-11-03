package verbs

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
)

// The machinery, on test-only verbs (the real commands are tested in
// pkg/commands).

type tItem struct {
	Alias string `json:"alias"`
	Level string `json:"level,omitempty" jsonschema:"enum=view,enum=interact"`
}

type tIn struct {
	Store string  `json:"store" slop:"pos=1" jsonschema_description:"the store"`
	Level string  `json:"level" slop:"pos=2" jsonschema:"enum=view,enum=interact,enum=admin" jsonschema_description:"the level"`
	Items []tItem `json:"items,omitempty" jsonschema_description:"the items"`
	Limit int     `json:"limit,omitempty"`
}

func tDef() Def[tIn, map[string]any] {
	return Def[tIn, map[string]any]{Name: "test.def", Doc: "a test", Scope: Write, Action: authz.Account,
		Run: func(r Req, in tIn) (map[string]any, error) {
			return map[string]any{"store": in.Store, "n": len(in.Items)}, nil
		}}
}

// A typed verb's arguments come from its input struct: names, positions,
// required (no omitempty), types, docs with enums and JSON shapes.
func TestDefArgs(t *testing.T) {
	v := tDef().Verb()
	want := []Arg{
		{Name: "store", Type: "string", Pos: 1, Required: true, Doc: "the store"},
		{Name: "level", Type: "string", Pos: 2, Required: true, Doc: "the level (one of view, interact, admin)"},
		{Name: "items", Type: "json", Doc: "the items, as JSON: [{alias, level?}, …]"},
		{Name: "limit", Type: "int"},
	}
	if !reflect.DeepEqual(v.Args, want) {
		t.Fatalf("args = %+v", v.Args)
	}
	if v.Effect != EffectWrite || v.Input == nil || v.Output == nil {
		t.Fatalf("verb = %+v", v)
	}
}

// Arguments the input does not have are refused, at any depth.
func TestDecodeArgs(t *testing.T) {
	if _, err := decodeArgs[tIn]("test.def", Args{"store": "s", "level": "view", "levle": "x"}); err == nil ||
		AsError(err).Code != "invalid_argument" || !strings.Contains(err.Error(), `"levle"`) {
		t.Fatalf("unknown argument: %v", err)
	}
	if _, err := decodeArgs[tIn]("test.def", Args{"store": "s", "level": "view", "items": []any{map[string]any{"alias": "a", "to": "x"}}}); err == nil {
		t.Fatal("unknown field in an item accepted")
	}
	in, err := decodeArgs[tIn]("test.def", Args{"store": "s", "level": "view", "items": []any{map[string]any{"alias": "a"}}})
	if err != nil || in.Store != "s" || len(in.Items) != 1 {
		t.Fatalf("decode: %+v %v", in, err)
	}
}

// A table runs its verbs, checks scope and required arguments, and an
// untyped verb's schema comes from its Args.
func TestTable(t *testing.T) {
	tb := NewTable()
	tb.Register(tDef().Verb(), &Verb{Name: "test.get", Scope: Read, Action: authz.Account,
		Args: []Arg{{Name: "path", Type: "string", Pos: 1, Required: true}, {Name: "n", Type: "int"}},
		Run:  func(context.Context, *access.Principal, Args) (any, error) { return "ok", nil }})
	reader := &access.Principal{Kind: access.KindToken, Scopes: []string{"read"}}
	if out, err := tb.Call(context.Background(), reader, "test.get", Args{"path": "x"}); err != nil || out != "ok" {
		t.Fatalf("call: %v %v", out, err)
	}
	if _, err := tb.Call(context.Background(), reader, "test.def", Args{"store": "s", "level": "view"}); err == nil || AsError(err).Code != "permission_denied" {
		t.Fatalf("a read token writes: %v", err)
	}
	if tb.Callable(reader, mustGet(t, tb, "test.def")) || !tb.Callable(reader, mustGet(t, tb, "test.get")) {
		t.Fatal("Callable")
	}
	if _, err := tb.Call(context.Background(), reader, "test.get", Args{}); err == nil || AsError(err).Code != "invalid_argument" {
		t.Fatalf("missing argument: %v", err)
	}
	if _, ok := Default.Get("test.get"); ok {
		t.Fatal("a table's verb leaked into Default")
	}
	g := mustGet(t, tb, "test.get")
	s := g.InputSchema()
	if p, ok := s.Properties.Get("path"); !ok || p.Type != "string" || len(s.Required) != 1 {
		t.Fatalf("test.get schema: %+v", s)
	}
	if tl := g.Tool(); tl.Name != "test_get" || !tl.Annotations["readOnlyHint"] {
		t.Fatalf("tool: %+v", tl)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("a duplicate registered")
		}
	}()
	tb.Register(g)
}

func mustGet(t *testing.T, tb *Table, name string) *Verb {
	t.Helper()
	v, ok := tb.Get(name)
	if !ok {
		t.Fatalf("no %s", name)
	}
	return v
}

// A List takes a JSON array or the CLI's comma-separated string; numbers
// in untyped fields stay exact.
func TestListAndExactNumbers(t *testing.T) {
	type in struct {
		Scopes List `json:"scopes,omitempty"`
		Data   any  `json:"data,omitempty"`
	}
	for _, raw := range []any{"read, write", []any{"read", "write"}} {
		x, err := decodeArgs[in]("t", Args{"scopes": raw})
		if err != nil || len(x.Scopes) != 2 || x.Scopes[0] != "read" || x.Scopes[1] != "write" {
			t.Fatalf("scopes %v: %v, %v", raw, x.Scopes, err)
		}
	}
	x, err := decodeArgs[in]("t", Args{"data": map[string]any{"n": json.Number("9007199254740993")}})
	if err != nil {
		t.Fatal(err)
	}
	if n := x.Data.(map[string]any)["n"]; n != json.Number("9007199254740993") {
		t.Fatalf("data.n = %#v, want the exact number", n)
	}
	if s := schemaOf(reflect.TypeFor[in]()); len(argsOf(reflect.TypeFor[in](), s)) != 2 {
		t.Fatal("List is not an argument")
	}
}
