package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/invopop/jsonschema"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// checkOutputs makes every verb of the table check its result against its
// output schema (what the MCP door publishes, and an agent validates
// structuredContent against): every end-to-end test then checks the
// results it produces.
func checkOutputs(t *testing.T, tb *verbs.Table) {
	for _, v := range tb.All() {
		if v.Output == nil {
			continue
		}
		run, schema, name := v.Run, v.Output, v.Name
		v.Run = func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
			out, err := run(ctx, p, a)
			if err == nil {
				b, merr := json.Marshal(out)
				if merr != nil {
					t.Errorf("%s: result does not marshal: %v", name, merr)
					return out, err
				}
				dec := json.NewDecoder(bytes.NewReader(b))
				dec.UseNumber()
				var x any
				_ = dec.Decode(&x)
				if cerr := conforms(schema, x, name); cerr != nil {
					t.Errorf("%s: result does not match its output schema: %v\nresult: %.400s", name, cerr, b)
				}
			}
			return out, err
		}
	}
}

// conforms checks x against the subset of JSON Schema that invopop emits
// for Go types: type, properties, required, additionalProperties, items,
// oneOf and enum.
func conforms(s *jsonschema.Schema, x any, at string) error {
	if s == nil || s == jsonschema.TrueSchema {
		return nil
	}
	if s == jsonschema.FalseSchema {
		return fmt.Errorf("%s: not allowed", at)
	}
	if len(s.OneOf) > 0 {
		for _, o := range s.OneOf {
			if conforms(o, x, at) == nil {
				return nil
			}
		}
		return fmt.Errorf("%s: matches none of oneOf", at)
	}
	if len(s.Enum) > 0 {
		ok := false
		for _, e := range s.Enum {
			if fmt.Sprint(e) == fmt.Sprint(x) {
				ok = true
			}
		}
		if !ok {
			return fmt.Errorf("%s: %v is not one of %v", at, x, s.Enum)
		}
	}
	switch s.Type {
	case "":
		return nil
	case "object":
		m, ok := x.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: %T, want an object", at, x)
		}
		for _, r := range s.Required {
			if _, ok := m[r]; !ok {
				return fmt.Errorf("%s: missing required %q", at, r)
			}
		}
		for k, val := range m {
			var ps *jsonschema.Schema
			if s.Properties != nil {
				ps, _ = s.Properties.Get(k)
			}
			if ps == nil {
				if s.AdditionalProperties == jsonschema.FalseSchema {
					return fmt.Errorf("%s: unexpected property %q", at, k)
				}
				ps = s.AdditionalProperties
			}
			if err := conforms(ps, val, at+"."+k); err != nil {
				return err
			}
		}
	case "array":
		l, ok := x.([]any)
		if !ok {
			return fmt.Errorf("%s: %T, want an array", at, x)
		}
		for i, e := range l {
			if err := conforms(s.Items, e, fmt.Sprintf("%s[%d]", at, i)); err != nil {
				return err
			}
		}
	case "string":
		if _, ok := x.(string); !ok {
			return fmt.Errorf("%s: %T, want a string", at, x)
		}
	case "integer", "number":
		n, ok := x.(json.Number)
		if !ok {
			return fmt.Errorf("%s: %T, want a number", at, x)
		}
		if s.Type == "integer" && strings.ContainsAny(n.String(), ".eE") {
			return fmt.Errorf("%s: %s, want an integer", at, n)
		}
	case "boolean":
		if _, ok := x.(bool); !ok {
			return fmt.Errorf("%s: %T, want a boolean", at, x)
		}
	case "null":
		if x != nil {
			return fmt.Errorf("%s: want null", at)
		}
	}
	return nil
}
