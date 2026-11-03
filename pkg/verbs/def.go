package verbs

// Typed verb definitions (SLOP3-009 step 2). A Def describes a verb by Go
// types: its input struct becomes the verb's arguments and a JSON Schema,
// its output type a second schema, and Run receives the decoded input. A Def
// produces an ordinary *Verb, so every door (the CLI, the HTTP API, trusted
// modules, eval programs) keeps working unchanged, and typed and untyped
// verbs live in one table.
//
// Field tags on the input struct:
//
//	json:"store"                      the argument's name (omitempty: optional)
//	jsonschema_description:"…"        its documentation
//	jsonschema:"enum=a,enum=b"        JSON Schema keywords (invopop/jsonschema)
//	slop:"pos=1"                      CLI position
//
// A field without omitempty is required. Unknown arguments are refused.

import (
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/invopop/jsonschema"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
)

// Effect says what a verb does, beyond its token scope: whether it changes
// governance (who may do what), which a person must confirm when an app
// calls it for them, or streams its result.
type Effect string

// Effects.
const (
	EffectRead   Effect = "read"
	EffectWrite  Effect = "write"
	EffectGovern Effect = "govern" // grants, roles, policy: an app's call needs the person's confirmation
	EffectStream Effect = "stream" // the result arrives in parts (Req.Emit), then whole
)

// Req is what a typed verb's Run receives, whichever door it came through.
// Dependencies are not here: the Def's Run closes over them.
type Req struct {
	context.Context
	Principal *access.Principal
}

type emitKey struct{}

// WithEmit is ctx with an emitter for a streaming verb's partial results:
// a door that can stream (SSE in the HTTP door) installs one.
func WithEmit(ctx context.Context, fn func(part any) error) context.Context {
	return context.WithValue(ctx, emitKey{}, fn)
}

// Emit sends a partial result of a stream verb (Effect stream) to its
// caller; with a caller that does not stream, it does nothing, and the
// caller receives only the result.
func Emit(ctx context.Context, part any) error {
	if fn, ok := ctx.Value(emitKey{}).(func(any) error); ok {
		return fn(part)
	}
	return nil
}

// Emit sends a partial result; see the function Emit.
func (r Req) Emit(part any) error { return Emit(r.Context, part) }

// Def is a typed verb.
type Def[In, Out any] struct {
	Name      string
	Doc       string
	Scope     Scope
	Effect    Effect // default: read or write, from Scope
	AdminOnly bool
	Action    authz.Action
	StoreArg  string
	Run       func(r Req, in In) (Out, error)
}

// Verb is the table entry for d: arguments and schemas derived from In and
// Out, and a Run that decodes its arguments into In.
func (d Def[In, Out]) Verb() *Verb {
	in := schemaOf(reflect.TypeFor[In]())
	v := &Verb{Name: d.Name, Doc: d.Doc, Scope: d.Scope, Effect: d.Effect, AdminOnly: d.AdminOnly,
		Action: d.Action, StoreArg: d.StoreArg, Input: in, Output: outputSchema(reflect.TypeFor[Out]()),
		Args: argsOf(reflect.TypeFor[In](), in)}
	if v.Effect == "" {
		v.Effect = EffectRead
		if d.Scope == Write {
			v.Effect = EffectWrite
		}
	}
	run := d.Run
	v.Run = func(ctx context.Context, p *access.Principal, a Args) (any, error) {
		x, err := decodeArgs[In](d.Name, a)
		if err != nil {
			return nil, err
		}
		return run(Req{Context: ctx, Principal: p}, x)
	}
	return v
}

// decodeArgs turns a call's arguments into In: through JSON, refusing
// arguments In does not have.
func decodeArgs[In any](verb string, a Args) (In, error) {
	var x In
	b, err := json.Marshal(a)
	if err != nil {
		return x, Errf("invalid_argument", "%s: %v", verb, err)
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	// Numbers in untyped fields (document bodies, actor arguments) stay
	// exact, as they arrive from the HTTP door (httpx reads with UseNumber).
	dec.UseNumber()
	if err := dec.Decode(&x); err != nil {
		msg := err.Error()
		msg = strings.TrimPrefix(msg, "json: ")
		if f, ok := strings.CutPrefix(msg, "unknown field "); ok {
			return x, Errf("invalid_argument", "%s takes no argument %s", verb, f)
		}
		return x, Errf("invalid_argument", "%s: %s", verb, msg)
	}
	return x, nil
}

var reflector = &jsonschema.Reflector{
	Anonymous:      true,
	DoNotReference: true,
	ExpandedStruct: true,
}

// schemaOf is t's JSON Schema; nil for an interface (an untyped result).
func schemaOf(t reflect.Type) *jsonschema.Schema {
	if t.Kind() == reflect.Interface {
		return nil
	}
	s := reflector.ReflectFromType(t)
	s.Version = ""
	return s
}

// outputSchema is t's schema as a result's: wherever Go can encode null (a
// nil pointer, slice or map), the schema allows it, so a client checking
// structured results against it (MCP) accepts what the verb returns.
func outputSchema(t reflect.Type) *jsonschema.Schema {
	s := schemaOf(t)
	if s != nil {
		nullable(t, s, map[reflect.Type]int{})
	}
	return s
}

// nullable walks t and its schema s together, letting null through for
// every nilable value.
func nullable(t reflect.Type, s *jsonschema.Schema, depth map[reflect.Type]int) {
	if s == nil || depth[t] > 2 { // recursive types: their schema is finite
		return
	}
	depth[t]++
	defer func() { depth[t]-- }()
	orNull := false
	for t.Kind() == reflect.Pointer {
		orNull, t = true, t.Elem()
	}
	if k := t.Kind(); k == reflect.Slice && t.Elem().Kind() != reflect.Uint8 { // []byte is a string
		orNull = true
		nullable(t.Elem(), s.Items, depth)
	} else if k == reflect.Map {
		orNull = true
		if s.AdditionalProperties != nil && s.AdditionalProperties != jsonschema.TrueSchema && s.AdditionalProperties != jsonschema.FalseSchema {
			nullable(t.Elem(), s.AdditionalProperties, depth)
		}
	} else if k == reflect.Struct && s.Properties != nil {
		structFields(t, func(name string, ft reflect.Type) {
			if ps, ok := s.Properties.Get(name); ok {
				nullable(ft, ps, depth)
			}
		})
	}
	if orNull && s.Type != "" && s.Type != "null" {
		inner := *s
		inner.Description = ""
		*s = jsonschema.Schema{Description: s.Description, OneOf: []*jsonschema.Schema{&inner, {Type: "null"}}}
	}
}

// structFields calls fn with the JSON name and type of each field of t
// that encodes, embedded structs flattened as encoding/json does.
func structFields(t reflect.Type, fn func(name string, ft reflect.Type)) {
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		tag := f.Tag.Get("json")
		name, _, _ := strings.Cut(tag, ",")
		if name == "-" {
			continue
		}
		if f.Anonymous && name == "" {
			ft := f.Type
			for ft.Kind() == reflect.Pointer {
				ft = ft.Elem()
			}
			if ft.Kind() == reflect.Struct {
				structFields(ft, fn)
				continue
			}
		}
		if !f.IsExported() {
			continue
		}
		if name == "" {
			name = f.Name
		}
		fn(name, f.Type)
	}
}

// argsOf lists a struct type's fields as verb arguments, for the doors that
// read Args (the CLI's flags and positions, Check's required arguments).
func argsOf(t reflect.Type, s *jsonschema.Schema) []Arg {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct || s == nil || s.Properties == nil {
		return nil
	}
	required := map[string]bool{}
	for _, r := range s.Required {
		required[r] = true
	}
	var out []Arg
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if !f.IsExported() || name == "-" {
			continue
		}
		if name == "" {
			name = f.Name
		}
		p, ok := s.Properties.Get(name)
		if !ok {
			continue
		}
		a := Arg{Name: name, Type: argType(p), Required: required[name], Doc: p.Description}
		if len(p.Enum) > 0 {
			var vs []string
			for _, e := range p.Enum {
				vs = append(vs, strings.Trim(string(mustJSON(e)), `"`))
			}
			a.Doc = strings.TrimSpace(a.Doc + " (one of " + strings.Join(vs, ", ") + ")")
		}
		if a.Type == "json" {
			if sh := shapeOf(p); sh != "any" { // an untyped value says nothing more
				a.Doc = strings.TrimSpace(a.Doc + ", as JSON: " + sh)
			}
		}
		for _, kv := range strings.Split(f.Tag.Get("slop"), ",") {
			if n, ok := strings.CutPrefix(kv, "pos="); ok {
				a.Pos, _ = strconv.Atoi(n)
			}
		}
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool {
		pi, pj := out[i].Pos, out[j].Pos
		return pi > 0 && (pj == 0 || pi < pj)
	})
	return out
}

func argType(p *jsonschema.Schema) string {
	switch p.Type {
	case "string":
		return "string"
	case "integer":
		return "int"
	case "boolean":
		return "bool"
	}
	return "json"
}

func mustJSON(v any) []byte { b, _ := json.Marshal(v); return b }

// List is a list of strings an argument takes as a JSON array or, as the
// CLI passes it, one comma-separated string ("read,write").
type List []string

// UnmarshalJSON accepts an array of strings (other values are formatted)
// or a comma-separated string.
func (l *List) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*l = List{}
		for _, x := range strings.Split(s, ",") {
			if x = strings.TrimSpace(x); x != "" {
				*l = append(*l, x)
			}
		}
		return nil
	}
	var xs []any
	if err := json.Unmarshal(b, &xs); err != nil {
		return err
	}
	*l = make(List, 0, len(xs))
	for _, x := range xs {
		if str, ok := x.(string); ok {
			*l = append(*l, str)
		} else {
			*l = append(*l, string(mustJSON(x)))
		}
	}
	return nil
}

// JSONSchema is a list's schema: an array of strings, or one string.
func (List) JSONSchema() *jsonschema.Schema {
	return &jsonschema.Schema{OneOf: []*jsonschema.Schema{
		{Type: "array", Items: &jsonschema.Schema{Type: "string"}},
		{Type: "string", Description: "comma-separated"},
	}}
}

// InputSchema is v's argument schema: a typed verb's own, or one made from
// an untyped verb's Args (json arguments accept any value).
func (v *Verb) InputSchema() *jsonschema.Schema {
	if v.Input != nil {
		return v.Input
	}
	props := jsonschema.NewProperties()
	var required []string
	for _, a := range v.Args {
		p := &jsonschema.Schema{Description: a.Doc}
		switch a.Type {
		case "string":
			p.Type = "string"
		case "int":
			p.Type = "integer"
		case "bool":
			p.Type = "boolean"
		}
		props.Set(a.Name, p)
		if a.Required {
			required = append(required, a.Name)
		}
	}
	return &jsonschema.Schema{Type: "object", Properties: props, Required: required}
}

// Tool is a verb described as an MCP tool.
type Tool struct {
	Name         string             `json:"name"`
	Description  string             `json:"description"`
	InputSchema  *jsonschema.Schema `json:"inputSchema"`
	OutputSchema *jsonschema.Schema `json:"outputSchema,omitempty"`
	Annotations  map[string]bool    `json:"annotations,omitempty"`
}

// Tool is v as an MCP tool: its name with "_" for "." (tool names are
// [A-Za-z0-9_-]), its schemas, and whether it only reads.
func (v *Verb) Tool() Tool {
	t := Tool{Name: strings.ReplaceAll(v.Name, ".", "_"), Description: v.Doc, InputSchema: v.InputSchema(), OutputSchema: v.Output}
	t.Annotations = map[string]bool{"readOnlyHint": v.Effect == EffectRead}
	if v.Output != nil && v.Output.Type != "object" {
		// MCP structured results are objects: a list or scalar result has no output schema there.
		t.OutputSchema = nil
	}
	return t
}

// shapeOf is a one-line sketch of a schema for help text:
// [{alias, target, prefix?}, …], [string, string, any] | {field, op, value}.
func shapeOf(s *jsonschema.Schema) string {
	switch {
	case s == nil:
		return "any"
	case len(s.OneOf) > 0:
		var alts []string
		for _, o := range s.OneOf {
			alts = append(alts, shapeOf(o))
		}
		return strings.Join(alts, " | ")
	case len(s.PrefixItems) > 0:
		var items []string
		for _, i := range s.PrefixItems {
			items = append(items, shapeOf(i))
		}
		return "[" + strings.Join(items, ", ") + "]"
	case s.Type == "array":
		return "[" + shapeOf(s.Items) + ", …]"
	case s.Type == "object" && s.Properties != nil:
		required := map[string]bool{}
		for _, r := range s.Required {
			required[r] = true
		}
		var keys []string
		for pair := s.Properties.Oldest(); pair != nil; pair = pair.Next() {
			k := pair.Key
			if !required[k] {
				k += "?"
			}
			keys = append(keys, k)
		}
		return "{" + strings.Join(keys, ", ") + "}"
	case s.Type != "":
		return s.Type
	}
	return "any"
}
