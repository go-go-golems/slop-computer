package actor

import (
	"context"
	"slices"
	"sort"

	"github.com/dop251/goja"
)

// A Module is a Go module an app's actor can use() once two things hold:
// app.json declares it (slop.modules) and an admin has trusted the app with
// it (app.trust). Modules that change the platform call verbs as the
// visitor, so they can do only what that person could (SLOP3-002).
type Module struct {
	Name string
	Doc  string
	Load func(a *Actor) goja.Value // builds the module's object for one actor
}

// Register adds a module to the registry.
func (m *Manager) Register(mod Module) {
	if m.modules == nil {
		m.modules = map[string]Module{}
	}
	m.modules[mod.Name] = mod
}

// Modules lists the registry by name.
func (m *Manager) Modules() []Module {
	out := make([]Module, 0, len(m.modules))
	for _, mod := range m.modules {
		out = append(out, mod)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// Module returns a registered module.
func (m *Manager) Module(name string) (Module, bool) {
	mod, ok := m.modules[name]
	return mod, ok
}

// trustedModule is use(name) for registry modules: the object, or nil when
// the module is unknown, undeclared or not trusted.
func (a *Actor) trustedModule(name string) goja.Value {
	mod, ok := a.m.modules[name]
	if !ok || !slices.Contains(a.run.Manifest.Slop.Modules, name) || a.m.Trusted == nil {
		return nil
	}
	if !a.m.Trusted(context.Background(), a.run.App, name) {
		return nil
	}
	return mod.Load(a)
}
