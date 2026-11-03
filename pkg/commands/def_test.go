package commands

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// listed is a table with every command, unbound (as the CLI lists them).
func listed() *verbs.Table {
	t := verbs.NewTable()
	Install(t, nil)
	return t
}

// The typed commands' arguments come from their input structs: names,
// positions, required, types, docs with enums and JSON shapes.
func TestDefArgs(t *testing.T) {
	tb := listed()
	v, _ := tb.Get("grant.set")
	want := []verbs.Arg{
		{Name: "store", Type: "string", Pos: 1, Required: true, Doc: "the store"},
		{Name: "subject", Type: "string", Pos: 2, Required: true, Doc: "usr_…, vis_…, store:<id>, @guest, @member or @subscriber"},
		{Name: "level", Type: "string", Pos: 3, Required: true, Doc: "the level to give (one of view, interact, admin, owner)"},
	}
	if !reflect.DeepEqual(v.Args, want) {
		t.Fatalf("grant.set args = %+v", v.Args)
	}
	q, _ := tb.Get("docs.query")
	var where verbs.Arg
	for _, a := range q.Args {
		if a.Name == "where" {
			where = a
		}
	}
	if where.Type != "json" || where.Required || !strings.Contains(where.Doc, "[[string, string, any] | {field, op, value}, …]") {
		t.Fatalf("docs.query where = %+v", where)
	}
	m, _ := tb.Get("mount.set")
	if m.Output == nil || m.Output.Properties == nil {
		t.Fatal("mount.set has no output schema")
	}
	if _, ok := m.Output.Properties.Get("mount"); !ok {
		t.Fatalf("mount.set output has no mount: %+v", m.Output)
	}
}

// Both forms of a where condition decode; a two-element one is refused.
func TestCondForms(t *testing.T) {
	var in DocsQueryIn
	raw := `{"store":"s","coll":"books","where":[["year",">=",2000],{"field":"lang","op":"==","value":"en"}]}`
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		t.Fatal(err)
	}
	want := []Cond{{Field: "year", Op: ">=", Value: 2000.0}, {Field: "lang", Op: "==", Value: "en"}}
	if !reflect.DeepEqual(in.Where, want) {
		t.Fatalf("where = %+v", in.Where)
	}
	if err := json.Unmarshal([]byte(`{"store":"s","coll":"c","where":[["year",">="]]}`), &in); err == nil {
		t.Fatal("a two-element condition accepted")
	}
	if rt.Filter(want[0]).Field != "year" {
		t.Fatal("Cond is not an rt.Filter")
	}
}

// Every command has an input schema and a tool form; an untyped one's
// schema comes from its Args.
func TestToolForms(t *testing.T) {
	tb := listed()
	for _, v := range tb.All() {
		tl := v.Tool()
		if tl.InputSchema == nil || tl.InputSchema.Type != "object" || strings.Contains(tl.Name, ".") {
			t.Fatalf("%s: tool %+v", v.Name, tl)
		}
	}
	g, _ := tb.Get("docs.get") // untyped
	s := g.InputSchema()
	if p, ok := s.Properties.Get("path"); !ok || p.Type != "string" || len(s.Required) != 2 {
		t.Fatalf("docs.get schema: %+v", s)
	}
	if !g.Tool().Annotations["readOnlyHint"] {
		t.Fatal("docs.get is not read-only")
	}
}

// Effects: read or write from the scope, govern on the verbs an app's call
// must have its person confirm (SLOP3-002's list), stream on sample.run.
func TestEffects(t *testing.T) {
	gov := map[string]bool{}
	for _, v := range listed().All() {
		switch v.Effect {
		case verbs.EffectRead, verbs.EffectWrite:
		case verbs.EffectGovern:
			gov[v.Name] = true
		case verbs.EffectStream:
			if v.Name != "sample.run" {
				t.Fatalf("%s streams", v.Name)
			}
		default:
			t.Fatalf("%s: effect %q", v.Name, v.Effect)
		}
		if v.Effect == verbs.EffectRead && v.Scope == verbs.Write {
			t.Fatalf("%s writes but says read", v.Name)
		}
	}
	want := map[string]bool{"people.role": true, "policy.set": true, "llm.set": true, "llm.rm": true, "llm.reset": true,
		"sub.grant": true, "sub.revoke": true, "secret.set": true, "secret.rm": true}
	if !reflect.DeepEqual(gov, want) {
		t.Fatalf("govern verbs = %v", gov)
	}
}
