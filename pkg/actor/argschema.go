package actor

// Action schemas (SLOP3-024 phase 2, design §5.4): an action may declare
// its arguments as a JSON Schema, and its result:
//
//	add: { requires: 'interact', args: { type: 'object', required: ['text'],
//	  properties: { text: { type: 'string', maxLength: 2000 } } }, run(ctx, args) { … } }
//
// The runtime checks the arguments before run: a wrong shape is
// invalid_argument with the failing path, and run never sees it. The
// result schema is not checked; with args it gives the action's
// declaration in actions.d.ts (app.types).

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/dop251/goja"
	"github.com/santhosh-tekuri/jsonschema/v6"
	"golang.org/x/text/language"
	"golang.org/x/text/message"
)

// english prints validation messages.
var english = message.NewPrinter(language.English)

// actionSchema is an action's declared schemas: args compiled, both as
// written (JSON).
type actionSchema struct {
	args       *jsonschema.Schema
	ArgsJSON   json.RawMessage
	ResultJSON json.RawMessage
}

// noLoader refuses every $ref outside the schema: an action's schema is
// self-contained, and the server fetches nothing.
type noLoader struct{}

func (noLoader) Load(url string) (any, error) {
	return nil, fmt.Errorf("%s: an action's schema may refer only to itself", url)
}

// schemaJSON is the JSON of a schema in the definition: an object, or
// true/false. nil when the action declares none.
func schemaJSON(v goja.Value) (json.RawMessage, error) {
	if v == nil || goja.IsUndefined(v) || goja.IsNull(v) {
		return nil, nil
	}
	switch x := v.Export().(type) {
	case bool, map[string]any:
		b, err := json.Marshal(x)
		if err != nil {
			return nil, err
		}
		return b, nil
	}
	return nil, errors.New("a schema is an object (or true or false)")
}

// compileSchema compiles one schema (draft 2020-12 unless it says).
func compileSchema(name string, raw json.RawMessage) (*jsonschema.Schema, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	c := jsonschema.NewCompiler()
	c.DefaultDraft(jsonschema.Draft2020)
	c.UseLoader(noLoader{})
	url := "mem:///actions/" + name + ".json"
	if err := c.AddResource(url, doc); err != nil {
		return nil, err
	}
	s, err := c.Compile(url)
	if err != nil {
		// The compiler's message names the mem:// URL: say which keyword.
		return nil, errors.New(strings.ReplaceAll(err.Error(), url, "the schema"))
	}
	return s, nil
}

// readSchema reads an action object's args and result.
func readSchema(name string, o *goja.Object) (*actionSchema, error) {
	args, err := schemaJSON(o.Get("args"))
	if err != nil {
		return nil, fmt.Errorf("action %s: args: %v", name, err)
	}
	result, err := schemaJSON(o.Get("result"))
	if err != nil {
		return nil, fmt.Errorf("action %s: result: %v", name, err)
	}
	if args == nil && result == nil {
		return nil, nil
	}
	s := &actionSchema{ArgsJSON: args, ResultJSON: result}
	if args != nil {
		if s.args, err = compileSchema(name+"/args", args); err != nil {
			return nil, fmt.Errorf("action %s: args: %v", name, err)
		}
	}
	if result != nil {
		if _, err := compileSchema(name+"/result", result); err != nil {
			return nil, fmt.Errorf("action %s: result: %v", name, err)
		}
	}
	return s, nil
}

// checkArgs validates an action's arguments against its args schema, and
// returns what run gets: the arguments, or {} for none when the action
// declares a schema.
func (a *Actor) checkArgs(action string, args any) (any, error) {
	s := a.schemas[action]
	if s == nil || s.args == nil {
		return args, nil
	}
	if args == nil {
		args = map[string]any{}
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, fail("invalid_argument", "%s: the arguments are not JSON: %v", action, err)
	}
	inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, fail("invalid_argument", "%s: the arguments are not JSON: %v", action, err)
	}
	if err := s.args.Validate(inst); err != nil {
		var ve *jsonschema.ValidationError
		if errors.As(err, &ve) {
			return nil, fail("invalid_argument", "%s: %s", action, describe(ve))
		}
		return nil, fail("invalid_argument", "%s: %v", action, err)
	}
	return args, nil
}

// describe is a validation error's leaves, one per failing place: "at
// /text: got number, want string; at /max: …" (at most three).
func describe(ve *jsonschema.ValidationError) string {
	var leaves []string
	var walk func(e *jsonschema.ValidationError)
	walk = func(e *jsonschema.ValidationError) {
		if len(e.Causes) == 0 {
			at := "/" + strings.Join(e.InstanceLocation, "/")
			if at == "/" {
				at = "the arguments"
			} else {
				at = "at " + at
			}
			msg := at + ": " + e.ErrorKind.LocalizedString(english)
			if !slices.Contains(leaves, msg) {
				leaves = append(leaves, msg)
			}
			return
		}
		for _, c := range e.Causes {
			walk(c)
		}
	}
	walk(ve)
	if len(leaves) > 3 {
		leaves = append(leaves[:3], fmt.Sprintf("and %d more", len(leaves)-3))
	}
	return strings.Join(leaves, "; ")
}

// ActionSchemas is the declared schemas of a store's running actor, by
// action (nil entries for actions that declare none), for actions.d.ts.
func (m *Manager) ActionSchemas(id string) (map[string]*actionSchema, bool) {
	a := m.Running(id)
	if a == nil {
		return nil, false
	}
	out := map[string]*actionSchema{}
	for _, name := range a.keys("actions") {
		out[name] = a.schemas[name]
	}
	return out, true
}
