package actor

import "github.com/dop251/goja"

// Provide serves a use() name from outside the runtime (SLOP3-010 PR 4):
// the actor door's bindings of capabilities that are not the actor's own
// store (room, sample, platform). load returns the module, or nil when
// this app may not use it (use() is then null). Provided names come before
// trusted modules.
func (m *Manager) Provide(name string, load func(a *Actor) goja.Value) {
	if m.provided == nil {
		m.provided = map[string]func(*Actor) goja.Value{}
	}
	m.provided[name] = load
}
