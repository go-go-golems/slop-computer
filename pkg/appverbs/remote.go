package appverbs

// Verbs without a command line (SLOP3-016 phase 5b): app.verb runs a verb on
// the server with its values as JSON, for MCP clients and agents, which
// cannot run JavaScript themselves. The verb is the same function, in the
// same kind of runtime, with the same slop module; only the values come
// from a map instead of flags, and the module's calls go to the verb table
// as the caller instead of over HTTP.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/schema"
	"github.com/go-go-golems/glazed/pkg/cmds/sources"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/go-go-goja/pkg/jsverbs"

	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// plainTypes are the field types an app verb may declare. The others
// (file, stringFromFile, objectFromFile, keyValue with @file, …) make
// Glazed read files while it parses: on the server a caller would name a
// server path, and in the CLI an app's verb could read one of the person's
// files (a default) and write it to the board. App verbs take values only.
var plainTypes = map[fields.Type]bool{
	fields.TypeString: true, fields.TypeBool: true, fields.TypeInteger: true, fields.TypeFloat: true,
	fields.TypeStringList: true, fields.TypeIntegerList: true, fields.TypeFloatList: true,
	fields.TypeChoice: true, fields.TypeChoiceList: true, fields.TypeDate: true,
}

// definitions is a verb's fields, with the section each belongs to.
func definitions(reg *jsverbs.Registry, verb *jsverbs.VerbSpec) (map[string]field, []string, error) {
	desc, err := reg.CommandDescriptionForVerb(verb)
	if err != nil {
		return nil, nil, err
	}
	out := map[string]field{}
	order := []string{}
	desc.Schema.ForEach(func(slug string, s schema.Section) {
		s.GetDefinitions().ForEach(func(d *fields.Definition) {
			if _, dup := out[d.Name]; !dup {
				order = append(order, d.Name)
			}
			out[d.Name] = field{section: slug, def: d}
		})
	})
	return out, order, nil
}

type field struct {
	section string
	def     *fields.Definition
}

// checkTypes refuses verbs with fields that read files (see plainTypes).
func checkTypes(reg *jsverbs.Registry) error {
	for _, v := range reg.Verbs() {
		defs, _, err := definitions(reg, v)
		if err != nil {
			return fmt.Errorf("%s: %w", v.FullPath(), err)
		}
		for name, f := range defs {
			if !plainTypes[f.def.Type] {
				return fmt.Errorf("%s: --%s is a %s field, which reads files; app verbs take plain values (string, bool, int, float, lists, choice, date)", v.FullPath(), name, f.def.Type)
			}
		}
	}
	return nil
}

// Values checks and converts a verb's values given as JSON (field names as
// the CLI's flags spell them) and adds the defaults, as the CLI's parser
// would.
func Values(reg *jsverbs.Registry, verb *jsverbs.VerbSpec, in map[string]any) (*values.Values, error) {
	defs, _, err := definitions(reg, verb)
	if err != nil {
		return nil, err
	}
	m := map[string]map[string]any{}
	for k, v := range in {
		f, ok := defs[k]
		if !ok {
			return nil, fmt.Errorf("%s has no field %q", verb.FullPath(), k)
		}
		if v == nil {
			continue
		}
		cv, err := coerce(f.def, plain(v))
		if err != nil {
			return nil, fmt.Errorf("%s: %s: %w", verb.FullPath(), k, err)
		}
		if m[f.section] == nil {
			m[f.section] = map[string]any{}
		}
		m[f.section][k] = cv
	}
	desc, err := reg.CommandDescriptionForVerb(verb)
	if err != nil {
		return nil, err
	}
	parsed := values.New()
	if err := sources.Execute(desc.Schema, parsed, sources.FromMap(m), sources.FromDefaults()); err != nil {
		return nil, fmt.Errorf("%s: %w", verb.FullPath(), err)
	}
	for name, f := range defs {
		if !f.def.Required {
			continue
		}
		if fv, ok := parsed.GetField(f.section, name); !ok || fv == nil || fv.Value == nil {
			return nil, fmt.Errorf("%s needs %s", verb.FullPath(), name)
		}
	}
	return parsed, nil
}

// coerce turns a JSON value into what Glazed expects for a field's type.
func coerce(d *fields.Definition, v any) (any, error) {
	//exhaustive:ignore // the other types are refused when the verbs are scanned (plainTypes)
	switch d.Type {
	case fields.TypeString, fields.TypeChoice, fields.TypeDate:
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("want a string, got %T", v)
		}
		if d.Type == fields.TypeChoice && len(d.Choices) > 0 && !contains(d.Choices, s) {
			return nil, fmt.Errorf("%q is not one of %s", s, strings.Join(d.Choices, ", "))
		}
		return s, nil
	case fields.TypeBool:
		b, ok := v.(bool)
		if !ok {
			return nil, fmt.Errorf("want true or false, got %T", v)
		}
		return b, nil
	case fields.TypeInteger:
		return toInt(v)
	case fields.TypeFloat:
		return toFloat(v)
	case fields.TypeStringList, fields.TypeChoiceList:
		list, ok := v.([]any)
		if !ok {
			return nil, fmt.Errorf("want a list of strings, got %T", v)
		}
		out := make([]string, 0, len(list))
		for _, e := range list {
			s, ok := e.(string)
			if !ok {
				return nil, fmt.Errorf("want a list of strings, got a %T in it", e)
			}
			if d.Type == fields.TypeChoiceList && len(d.Choices) > 0 && !contains(d.Choices, s) {
				return nil, fmt.Errorf("%q is not one of %s", s, strings.Join(d.Choices, ", "))
			}
			out = append(out, s)
		}
		return out, nil
	case fields.TypeIntegerList:
		list, ok := v.([]any)
		if !ok {
			return nil, fmt.Errorf("want a list of integers, got %T", v)
		}
		out := make([]int, 0, len(list))
		for _, e := range list {
			i, err := toInt(e)
			if err != nil {
				return nil, err
			}
			out = append(out, i)
		}
		return out, nil
	case fields.TypeFloatList:
		list, ok := v.([]any)
		if !ok {
			return nil, fmt.Errorf("want a list of numbers, got %T", v)
		}
		out := make([]float64, 0, len(list))
		for _, e := range list {
			f, err := toFloat(e)
			if err != nil {
				return nil, err
			}
			out = append(out, f)
		}
		return out, nil
	}
	return nil, fmt.Errorf("fields of type %s are not taken", d.Type)
}

func toInt(v any) (int, error) {
	switch x := v.(type) {
	case int64:
		return int(x), nil
	case int:
		return x, nil
	case float64:
		if x == math.Trunc(x) && math.Abs(x) < 1<<53 {
			return int(x), nil
		}
	}
	return 0, fmt.Errorf("want an integer, got %v", v)
}

func toFloat(v any) (float64, error) {
	switch x := v.(type) {
	case int64:
		return float64(x), nil
	case int:
		return float64(x), nil
	case float64:
		return x, nil
	}
	return 0, fmt.Errorf("want a number, got %v", v)
}

func contains(list []string, s string) bool {
	for _, e := range list {
		if e == s {
			return true
		}
	}
	return false
}

// InputSchema is a verb's fields as a JSON Schema object (an MCP tool's
// input), with extra properties first (such as the store).
func InputSchema(reg *jsverbs.Registry, verb *jsverbs.VerbSpec, extra map[string]any, extraRequired ...string) (map[string]any, error) {
	defs, order, err := definitions(reg, verb)
	if err != nil {
		return nil, err
	}
	props := map[string]any{}
	for k, v := range extra {
		props[k] = v
	}
	required := append([]string{}, extraRequired...)
	for _, name := range order {
		d := defs[name].def
		p := map[string]any{}
		//exhaustive:ignore // strings and the plain types; the rest are refused at scan time
		switch d.Type {
		case fields.TypeBool:
			p["type"] = "boolean"
		case fields.TypeInteger:
			p["type"] = "integer"
		case fields.TypeFloat:
			p["type"] = "number"
		case fields.TypeStringList:
			p["type"], p["items"] = "array", map[string]any{"type": "string"}
		case fields.TypeIntegerList:
			p["type"], p["items"] = "array", map[string]any{"type": "integer"}
		case fields.TypeFloatList:
			p["type"], p["items"] = "array", map[string]any{"type": "number"}
		case fields.TypeChoice:
			p["type"], p["enum"] = "string", d.Choices
		case fields.TypeChoiceList:
			p["type"], p["items"] = "array", map[string]any{"type": "string", "enum": d.Choices}
		case fields.TypeDate:
			p["type"], p["format"] = "string", "date"
		default:
			p["type"] = "string"
		}
		if d.Help != "" {
			p["description"] = d.Help
		}
		if d.Default != nil {
			p["default"] = *d.Default
		}
		props[name] = p
		if d.Required {
			required = append(required, name)
		}
	}
	out := map[string]any{"type": "object", "properties": props, "additionalProperties": false}
	if len(required) > 0 {
		sort.Strings(required[len(extraRequired):])
		out["required"] = required
	}
	return out, nil
}

// Run runs one verb, named by its path ("clip add"), with values given as
// JSON, on b through c: the remote invoker. Console output goes to logs.
// The verb is interrupted when ctx ends or after limit.
func Run(ctx context.Context, reg *jsverbs.Registry, path string, in map[string]any, c Caller, b Board, logs io.Writer, limit time.Duration) (any, error) {
	verb, ok := reg.Verb(path)
	if !ok {
		return nil, verbs.Errf("not_found", "%s has no verb %q", b.App, path)
	}
	parsed, err := Values(reg, verb, in)
	if err != nil {
		return nil, verbs.Errf("invalid_argument", "%s", err.Error())
	}
	if limit > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, limit)
		defer cancel()
	}
	out, err := Invoker(c, b, logs)(ctx, reg, verb, parsed)
	if err != nil {
		return nil, err
	}
	// Through JSON, as a result leaves the server anyway: goja's exported
	// values (int64, nested maps) become plain data.
	raw, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("%s: its result is not JSON: %w", path, err)
	}
	var res any
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, err
	}
	return res, nil
}

// Cache keeps scanned registries per app@snapshot (a snapshot never
// changes), at most n of them.
type Cache struct {
	mu   sync.Mutex
	n    int
	regs map[string]*jsverbs.Registry
	keys []string
}

// NewCache makes a cache of at most n registries.
func NewCache(n int) *Cache { return &Cache{n: n, regs: map[string]*jsverbs.Registry{}} }

// Lookup is the registry cached for key (app@snapshot), or nil.
func (c *Cache) Lookup(key string) *jsverbs.Registry {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.regs[key]
}

// Get scans src, or returns the registry scanned for its key before.
func (c *Cache) Get(src *Source) (*jsverbs.Registry, error) {
	key := src.Key()
	c.mu.Lock()
	reg := c.regs[key]
	c.mu.Unlock()
	if reg != nil {
		return reg, nil
	}
	reg, err := Scan(src)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, ok := c.regs[key]; !ok {
		if len(c.keys) >= c.n {
			delete(c.regs, c.keys[0])
			c.keys = c.keys[1:]
		}
		c.keys = append(c.keys, key)
	}
	c.regs[key] = reg
	return reg, nil
}

// ToolName is a verb's MCP tool name: the alias and the verb's words,
// joined by "_" (pb_clip_add).
func ToolName(alias string, verb *jsverbs.VerbSpec) string {
	return alias + "_" + strings.ReplaceAll(verb.FullPath(), " ", "_")
}
