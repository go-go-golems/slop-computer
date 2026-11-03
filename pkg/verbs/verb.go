// Package verbs is the table of every operation of the platform. The CLI,
// the HTTP API and eval programs are all generated from it.
package verbs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/invopop/jsonschema"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// Scope says whether a verb changes anything: a token needs the read scope
// for a Read verb and the write scope for a Write verb. (A token's admin
// scope is not about verbs: it lets the token act with its person's admin
// role, which admin-only verbs require; see access.Principal.Role.)
type Scope string

// Scopes, ordered.
const (
	Read  Scope = "read"
	Write Scope = "write"
)

// Arg describes one argument.
type Arg struct {
	Name     string `json:"name"`
	Type     string `json:"type"` // string, int, bool, json
	Pos      int    `json:"pos,omitempty"`
	Required bool   `json:"required,omitempty"`
	Doc      string `json:"doc,omitempty"`
}

// Verb is one operation.
type Verb struct {
	Name      string `json:"name"` // group.name
	Doc       string `json:"doc"`
	Args      []Arg  `json:"args"`
	Scope     Scope  `json:"scope"`
	AdminOnly bool   `json:"adminOnly,omitempty"` // the person must be an admin
	// Action is what the verb does; Call checks its floor before Run. For
	// an action on a store, StoreArg names the argument holding the store
	// ("store" when empty); "-" means the store is found from other
	// arguments, and Run checks it.
	Action   authz.Action `json:"action"`
	StoreArg string       `json:"-"`
	// Effect, Input and Output (SLOP3-009): what the verb does beyond its
	// scope, and its argument and result schemas. A typed verb (Def) has
	// both schemas; an untyped one has neither, and Register derives Effect
	// from Scope.
	Effect Effect             `json:"effect,omitempty"`
	Input  *jsonschema.Schema `json:"input,omitempty"`
	Output *jsonschema.Schema `json:"output,omitempty"`

	Run func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) `json:"-"`
}

// Group is the part before the dot ("grant" of "grant.set").
func (v *Verb) Group() string { g, _, _ := strings.Cut(v.Name, "."); return g }

// Short is the part after the dot, or the whole name.
func (v *Verb) Short() string {
	if _, s, ok := strings.Cut(v.Name, "."); ok {
		return s
	}
	return v.Name
}

var registry = map[string]*Verb{}

// Register adds verbs to the table.
func Register(vs ...*Verb) {
	for _, v := range vs {
		if _, dup := registry[v.Name]; dup {
			panic("duplicate verb " + v.Name)
		}
		if v.Effect == "" {
			v.Effect = EffectRead
			if v.Scope == Write {
				v.Effect = EffectWrite
			}
		}
		registry[v.Name] = v
	}
}

// Get returns a verb by name.
func Get(name string) (*Verb, bool) { v, ok := registry[name]; return v, ok }

// All returns every verb, sorted by name.
func All() []*Verb {
	out := make([]*Verb, 0, len(registry))
	for _, v := range registry {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Args are a verb call's arguments, as decoded JSON.
type Args map[string]any

// S returns a string argument.
func (a Args) S(k string) string {
	switch v := a[k].(type) {
	case string:
		return v
	case nil:
		return ""
	case json.Number:
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(v)
	}
	b, _ := json.Marshal(a[k])
	return string(b)
}

// I returns an int argument (def when absent).
func (a Args) I(k string, def int64) int64 {
	switch v := a[k].(type) {
	case float64:
		return int64(v)
	case int:
		return int64(v)
	case int64:
		return v
	case json.Number:
		n, err := v.Int64()
		if err == nil {
			return n
		}
	case string:
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return def
}

// B returns a bool argument.
func (a Args) B(k string) bool {
	switch v := a[k].(type) {
	case bool:
		return v
	case string:
		return v == "true" || v == "1" || v == "yes" || v == "on"
	case float64:
		return v != 0
	}
	return false
}

// Has reports whether an argument was given.
func (a Args) Has(k string) bool { _, ok := a[k]; return ok }

// Strings returns a list argument (a JSON array, or a comma-separated string).
func (a Args) Strings(k string) []string {
	switch v := a[k].(type) {
	case []any:
		out := []string{}
		for _, x := range v {
			out = append(out, fmt.Sprint(x))
		}
		return out
	case []string:
		return v
	case string:
		if v == "" {
			return nil
		}
		out := []string{}
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				out = append(out, s)
			}
		}
		return out
	}
	return nil
}

// Error is a verb failure with a stable code.
type Error struct {
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Trace   []string `json:"trace,omitempty"`
	Extra   any      `json:"extra,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// Status is the HTTP status for an error code.
func (e *Error) Status() int {
	switch e.Code {
	case "invalid_argument", "eval_error":
		return 400
	case "unauthenticated":
		return 401
	case "permission_denied", "audience_required":
		return 403
	case "not_found":
		return 404
	case "conflict", "missing_blobs":
		return 409
	case "quota_exceeded", "rate_limited":
		return 429
	case "unavailable":
		return 503
	}
	return 500
}

// Errf makes an Error.
func Errf(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// AsError converts any error to an *Error (internal errors become "internal").
func AsError(err error) *Error {
	var e *Error
	if errors.As(err, &e) {
		return e
	}
	return &Error{Code: "internal", Message: err.Error()}
}

// Call runs a verb for a principal: scope, admin check, required args, Run.
func Call(ctx context.Context, e *Env, p *access.Principal, name string, a Args) (any, error) {
	if a == nil {
		a = Args{}
	}
	if err := Check(p, name, a); err != nil {
		return nil, err
	}
	v, _ := Get(name)
	if spec, _ := authz.Of(v.Action); spec.Store {
		if id := v.store(a); id != "" {
			if _, _, err := e.open(ctx, p, id, spec.Level, v.Name); err != nil {
				return nil, err
			}
		}
	}
	return v.Run(ctx, e, p, a)
}

// store is the store a verb's action is on ("" when Run finds it).
func (v *Verb) store(a Args) string {
	switch v.StoreArg {
	case "-":
		return ""
	case "":
		return a.S("store")
	}
	return a.S(v.StoreArg)
}

// Check runs the checks Call makes before Run: the verb exists, the token
// has its scope, admins only, no guest writes, required arguments.
func Check(p *access.Principal, name string, a Args) error {
	v, ok := Get(name)
	if !ok {
		return Errf("not_found", "no verb %q", name)
	}
	if !p.HasScope(string(v.Scope)) {
		return Errf("permission_denied", "this token lacks the %s scope", v.Scope)
	}
	if _, ok := authz.Of(v.Action); !ok {
		return Errf("internal", "%s declares no action", v.Name)
	}
	// the role half of the floor; Call checks the level on the store
	ok, _ = authz.Floor(v.Action, rt.LevelOwner, p.IsAdmin())
	if !ok || (v.AdminOnly && !p.IsAdmin()) {
		if p.Kind == access.KindToken && p.Person != nil && p.Person.Role == system.RoleAdmin {
			return Errf("permission_denied", "%s needs a token with the admin scope", v.Name)
		}
		return Errf("permission_denied", "%s is for admins", v.Name)
	}
	if v.Scope != Read && p.Kind == access.KindGuest {
		return Errf("permission_denied", "sign in to %s", v.Name)
	}
	for _, arg := range v.Args {
		if arg.Required && !a.Has(arg.Name) {
			return Errf("invalid_argument", "%s needs %s", v.Name, arg.Name)
		}
	}
	return nil
}
