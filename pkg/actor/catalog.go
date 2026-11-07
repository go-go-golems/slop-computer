package actor

// The module catalog (SLOP3-012 part 2): every Go module an actor can
// use() or require() by name, with its class, its configuration type and
// its TypeScript declarations. A module's class says where its safety comes
// from (guide §19): the per-store VM isolates JavaScript from JavaScript and
// nothing else, since a Go module runs with the slop process's privileges.
//
//   - data: touches nothing outside the VM (path).
//   - own: reaches only the app's own store, or memory the actor owns
//     (database, express, fs). On by default; an admin's grant may only
//     configure it.
//   - scoped: reaches outside the store through a slop backend that checks
//     every call. Needs a grant.
//   - trusted: calls verbs as the visitor (system, workshop). Needs
//     slop.modules in app.json and a grant from a current admin.
//
// A grant (app.trust) carries a configuration, decoded strictly into the
// module's Go config struct and validated before it is stored, and again
// when the module loads. The admin's configuration is the only one that
// applies.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/dop251/goja"
)

// Class says where a module's safety comes from.
type Class string

// The module classes.
const (
	ClassData    Class = "data"
	ClassOwn     Class = "own"
	ClassScoped  Class = "scoped"
	ClassTrusted Class = "trusted"
)

// Default reports whether modules of the class are on without a grant
// (their grant only configures them).
func (c Class) Default() bool { return c == ClassData || c == ClassOwn }

// A Module is a Go module an app's actor can use(). Modules of the scoped
// and trusted classes need a grant (app.trust); trusted ones also need
// slop.modules in app.json, and call verbs as the visitor, so they can do
// only what that person could (SLOP3-002).
type Module struct {
	Name  string
	Class Class
	Doc   string
	// Config is a zero value of the module's configuration struct (nil: the
	// module takes none). A config may implement Validate() error.
	Config any
	// TypeScript declares the module for authors and agents (app.modules).
	TypeScript string
	// Load builds the module's object for one actor with its decoded
	// configuration (a pointer to a Config copy; nil when Config is nil).
	Load func(s Setup) goja.Value
}

// Setup is what a module's Load gets.
type Setup struct {
	Actor  *Actor
	Config any // *T for the module's Config T, the grant's or the zero value
}

// Grant is an app's grant of a module, as governance stores it.
type Grant struct {
	Config json.RawMessage
	// Current is false once the admin who made the grant is no longer an
	// admin (SLOP3-007): a privilege lapses, a restriction does not.
	Current bool
}

// validator is a configuration that checks itself.
type validator interface{ Validate() error }

// DecodeConfig decodes raw strictly into a new copy of mod's configuration
// and validates it. Empty raw (or {}) is the zero configuration.
func (mod Module) DecodeConfig(raw json.RawMessage) (any, error) {
	if mod.Config == nil {
		if len(bytes.TrimSpace(raw)) == 0 || string(bytes.TrimSpace(raw)) == "{}" || string(bytes.TrimSpace(raw)) == "null" {
			return nil, nil
		}
		return nil, fmt.Errorf("%s takes no configuration", mod.Name)
	}
	cfg := reflect.New(reflect.TypeOf(mod.Config)).Interface()
	if len(bytes.TrimSpace(raw)) > 0 && string(bytes.TrimSpace(raw)) != "null" {
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.DisallowUnknownFields()
		if err := dec.Decode(cfg); err != nil {
			msg := strings.TrimPrefix(err.Error(), "json: ")
			if f, ok := strings.CutPrefix(msg, "unknown field "); ok {
				return nil, fmt.Errorf("%s's configuration has no field %s", mod.Name, f)
			}
			return nil, fmt.Errorf("%s's configuration: %s", mod.Name, msg)
		}
		if dec.More() {
			return nil, fmt.Errorf("%s's configuration: one JSON object, please", mod.Name)
		}
		// encoding/json matches field names without regard to case, even
		// with DisallowUnknownFields ("readonly" sets ReadOnly): a near-miss
		// is an error here, as a misspelled field is.
		if err := exactKeys(reflect.TypeOf(mod.Config), raw); err != nil {
			return nil, fmt.Errorf("%s's configuration has %v", mod.Name, err)
		}
	}
	if v, ok := cfg.(validator); ok {
		if err := v.Validate(); err != nil {
			return nil, fmt.Errorf("%s's configuration: %v", mod.Name, err)
		}
	}
	return cfg, nil
}

// exactKeys checks that every key of the JSON object raw is the exact JSON
// name of a field of struct type t, and so for nested structs.
func exactKeys(t reflect.Type, raw json.RawMessage) error {
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return nil
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(raw, &obj) != nil {
		return nil // not an object: Decode already said so, or it is null
	}
	fields := map[string]reflect.Type{}
	for i := range t.NumField() {
		f := t.Field(i)
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "-" || !f.IsExported() {
			continue
		}
		if name == "" {
			name = f.Name
		}
		fields[name] = f.Type
	}
	for k, v := range obj {
		ft, ok := fields[k]
		if !ok {
			return fmt.Errorf("no field %q", k)
		}
		if err := exactKeys(ft, v); err != nil {
			return err
		}
	}
	return nil
}

// CanonicalConfig is the configuration as stored: the decoded struct
// encoded again ("{}" for none).
func (mod Module) CanonicalConfig(raw json.RawMessage) (string, error) {
	cfg, err := mod.DecodeConfig(raw)
	if err != nil {
		return "", err
	}
	if cfg == nil {
		return "{}", nil
	}
	b, err := json.Marshal(cfg)
	return string(b), err
}

// Register adds a module to the catalog.
func (m *Manager) Register(mod Module) {
	if m.modules == nil {
		m.modules = map[string]Module{}
	}
	if mod.Class == "" {
		mod.Class = ClassTrusted
	}
	m.modules[mod.Name] = mod
}

// Modules lists the catalog by name.
func (m *Manager) Modules() []Module {
	out := make([]Module, 0, len(m.modules))
	for _, mod := range m.modules {
		out = append(out, mod)
	}
	slices.SortFunc(out, func(x, y Module) int { return strings.Compare(x.Name, y.Name) })
	return out
}

// Module returns a catalog module.
func (m *Manager) Module(name string) (Module, bool) {
	mod, ok := m.modules[name]
	return mod, ok
}

// grant looks up an app's grant of a module.
func (m *Manager) grant(app, module string) (Grant, bool) {
	if m.Grant == nil {
		return Grant{}, false
	}
	return m.Grant(context.Background(), app, module)
}

// trusted reports whether an app holds a current grant of a module.
func (m *Manager) trusted(app, module string) bool {
	g, ok := m.grant(app, module)
	return ok && g.Current
}

// catalogModule is use(name) for a catalog module: its object, built once
// per actor, or null when the app may not use it.
func (a *Actor) catalogModule(mod Module) goja.Value {
	if v, ok := a.loaded[mod.Name]; ok {
		return v
	}
	g, granted := a.m.grant(a.run.App, mod.Name)
	if !mod.Class.Default() {
		// A privilege: declared by the app, granted by a current admin.
		if mod.Class == ClassTrusted && !slices.Contains(a.run.Manifest.Slop.Modules, mod.Name) {
			return goja.Null()
		}
		if !granted || !g.Current {
			return goja.Null()
		}
	}
	// A default module's grant restricts it, and keeps doing so after its
	// admin steps down: it applies whether or not the grant is current.
	cfg, err := mod.DecodeConfig(g.Config)
	if err != nil {
		// The stored configuration no longer decodes (the module changed):
		// fail closed rather than fall back to the unrestricted default.
		a.throw(fail("unavailable", "%v; an admin must grant it again (app.trust)", err))
	}
	v := mod.Load(Setup{Actor: a, Config: cfg})
	if v == nil {
		v = goja.Null()
	}
	if obj, ok := v.(*goja.Object); ok {
		a.intercept(mod, obj, map[*goja.Object]bool{})
	}
	if a.loaded == nil {
		a.loaded = map[string]goja.Value{}
	}
	a.loaded[mod.Name] = v
	return v
}

// intercept wraps the functions of a module's object (and of the plain
// objects under it, such as system.people) so each call is counted and, for
// modules that need a grant, finds the grant still current: withdrawing it
// or demoting its admin takes effect on the next call, not at restart.
func (a *Actor) intercept(mod Module, obj *goja.Object, seen map[*goja.Object]bool) {
	if seen[obj] {
		return
	}
	seen[obj] = true
	counter := a.m.meter(a.run.App, mod.Name)
	for _, k := range obj.Keys() {
		v := obj.Get(k)
		f, ok := goja.AssertFunction(v)
		if !ok {
			if sub, ok := v.(*goja.Object); ok && sub.ClassName() == "Object" {
				a.intercept(mod, sub, seen)
			}
			continue
		}
		fn := v.(*goja.Object)
		wrapped := func(call goja.FunctionCall) goja.Value {
			counter.Add(1)
			if !mod.Class.Default() && !a.m.trusted(a.run.App, mod.Name) {
				a.throw(fail("permission_denied", "%s is no longer trusted with %s", a.run.App, mod.Name))
			}
			out, err := f(call.This, call.Arguments...)
			if err != nil {
				panic(err) // rethrow the JavaScript exception as is
			}
			return out
		}
		w := a.vm.ToValue(wrapped).(*goja.Object)
		// Keep properties of the function itself (express.Router and the
		// like), and the function's name.
		for _, pk := range fn.Keys() {
			_ = w.Set(pk, fn.Get(pk))
		}
		_ = obj.Set(k, w)
	}
}

// meters counts module calls per app and module, since the process started.
type meters struct {
	mu sync.Mutex
	n  map[string]*atomic.Int64 // "app module"
}

func (m *Manager) meter(app, module string) *atomic.Int64 {
	m.calls.mu.Lock()
	defer m.calls.mu.Unlock()
	if m.calls.n == nil {
		m.calls.n = map[string]*atomic.Int64{}
	}
	k := app + " " + module
	c := m.calls.n[k]
	if c == nil {
		c = &atomic.Int64{}
		m.calls.n[k] = c
	}
	return c
}

// ModuleCalls is how often an app's actors called each module's functions
// since the process started.
func (m *Manager) ModuleCalls(app string) map[string]int64 {
	m.calls.mu.Lock()
	defer m.calls.mu.Unlock()
	out := map[string]int64{}
	for k, c := range m.calls.n {
		if a, mod, _ := strings.Cut(k, " "); a == app {
			out[mod] = c.Load()
		}
	}
	return out
}
