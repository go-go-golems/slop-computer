package verbs

import (
	"reflect"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// A typed verb's arguments come from its input struct: names, positions,
// required (no omitempty), types, docs with enums and JSON shapes.
func TestDefArgs(t *testing.T) {
	v, _ := Get("grant.set")
	want := []Arg{
		{Name: "store", Type: "string", Pos: 1, Required: true, Doc: "the store"},
		{Name: "subject", Type: "string", Pos: 2, Required: true, Doc: "usr_…, vis_…, store:<id>, @guest, @member or @subscriber"},
		{Name: "level", Type: "string", Pos: 3, Required: true, Doc: "the level to give (one of view, interact, admin, owner)"},
	}
	if !reflect.DeepEqual(v.Args, want) {
		t.Fatalf("grant.set args = %+v", v.Args)
	}
	q, _ := Get("docs.query")
	var where Arg
	for _, a := range q.Args {
		if a.Name == "where" {
			where = a
		}
	}
	if where.Type != "json" || where.Required || !strings.Contains(where.Doc, "[[string, string, any] | {field, op, value}, …]") {
		t.Fatalf("docs.query where = %+v", where)
	}
	m, _ := Get("mount.set")
	if m.Output == nil || m.Output.Properties == nil {
		t.Fatal("mount.set has no output schema")
	}
	if _, ok := m.Output.Properties.Get("mount"); !ok {
		t.Fatalf("mount.set output has no mount: %+v", m.Output)
	}
}

// Arguments the input does not have are refused, at any depth; both forms
// of a where condition decode.
func TestDecodeArgs(t *testing.T) {
	if _, err := decodeArgs[GrantSetIn]("grant.set", Args{"store": "s", "subject": "@guest", "level": "view", "levle": "x"}); err == nil ||
		AsError(err).Code != "invalid_argument" || !strings.Contains(err.Error(), `"levle"`) {
		t.Fatalf("unknown argument: %v", err)
	}
	if _, err := decodeArgs[MountSetIn]("mount.set", Args{"host": "h", "path": "/d/:id", "aliases": []any{map[string]any{"alias": "a", "target": "t", "to": "x"}}}); err == nil {
		t.Fatal("unknown field in an alias template accepted")
	}
	in, err := decodeArgs[DocsQueryIn]("docs.query", Args{"store": "s", "coll": "books",
		"where": []any{[]any{"year", ">=", 2000}, map[string]any{"field": "lang", "op": "==", "value": "en"}}})
	if err != nil {
		t.Fatal(err)
	}
	want := []Cond{{Field: "year", Op: ">=", Value: 2000.0}, {Field: "lang", Op: "==", Value: "en"}}
	if !reflect.DeepEqual(in.Where, want) {
		t.Fatalf("where = %+v", in.Where)
	}
	if _, err := decodeArgs[DocsQueryIn]("docs.query", Args{"store": "s", "coll": "c", "where": []any{[]any{"year", ">="}}}); err == nil {
		t.Fatal("a two-element condition accepted")
	}
	if rt.Filter(want[0]).Field != "year" {
		t.Fatal("Cond is not an rt.Filter")
	}
}

// Every verb has an input schema and a tool form; an untyped verb's schema
// comes from its Args.
func TestToolForms(t *testing.T) {
	for _, v := range All() {
		tl := v.Tool()
		if tl.InputSchema == nil || tl.InputSchema.Type != "object" || strings.Contains(tl.Name, ".") {
			t.Fatalf("%s: tool %+v", v.Name, tl)
		}
	}
	g, _ := Get("docs.get") // untyped
	s := g.InputSchema()
	if p, ok := s.Properties.Get("path"); !ok || p.Type != "string" || len(s.Required) != 2 {
		t.Fatalf("docs.get schema: %+v", s)
	}
	if !g.Tool().Annotations["readOnlyHint"] {
		t.Fatal("docs.get is not read-only")
	}
}

// Effects: read or write from the scope, govern on the verbs an app's call
// must have its person confirm (SLOP3-002's list).
func TestEffects(t *testing.T) {
	gov := map[string]bool{}
	for _, v := range All() {
		switch v.Effect {
		case EffectRead, EffectWrite:
		case EffectGovern:
			gov[v.Name] = true
		case EffectStream: // sample.run (pkg/caps/sample, not linked here)
		default:
			t.Fatalf("%s: effect %q", v.Name, v.Effect)
		}
		if v.Effect == EffectRead && v.Scope == Write {
			t.Fatalf("%s writes but says read", v.Name)
		}
	}
	want := map[string]bool{"people.role": true, "policy.set": true, "llm.set": true, "llm.rm": true, "llm.reset": true,
		"sub.grant": true, "sub.revoke": true, "secret.set": true, "secret.rm": true}
	if !reflect.DeepEqual(gov, want) {
		t.Fatalf("govern verbs = %v", gov)
	}
}
