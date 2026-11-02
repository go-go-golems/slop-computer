package server

import (
	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/actor"
)

// systemFuncs is the system module: the platform's governance verbs, each
// called as the visitor. Changes to roles, policy, LLM budgets, comps and
// secrets are governance: made through an app, the person confirms them.
// Trust (app.trust) is deliberately absent, so no app can widen its own
// powers.
var systemFuncs = []modFunc{
	{JS: "people.list", Verb: "people.ls", Pos: []string{"kind"}},
	{JS: "people.setRole", Verb: "people.role", Pos: []string{"id", "role"}, Confirm: true},
	{JS: "grants.list", Verb: "grant.ls", Pos: []string{"store"}},
	{JS: "grants.set", Verb: "grant.set", Pos: []string{"store", "subject", "level"}},
	{JS: "grants.remove", Verb: "grant.rm", Pos: []string{"store", "subject"}},
	{JS: "links.list", Verb: "link.ls", Pos: []string{"store"}},
	{JS: "links.create", Verb: "link.new", Pos: []string{"store", "level"}},
	{JS: "links.revoke", Verb: "link.rm", Pos: []string{"id"}},
	{JS: "mounts.list", Verb: "mount.ls", Pos: []string{"host"}},
	{JS: "mounts.set", Verb: "mount.set", Pos: []string{"host", "path", "store"}},
	{JS: "mounts.remove", Verb: "mount.rm", Pos: []string{"host", "path"}},
	{JS: "mounts.undo", Verb: "mount.undo", Pos: []string{"host", "path"}},
	{JS: "policy.list", Verb: "policy.ls", Pos: []string{"app"}},
	{JS: "policy.set", Verb: "policy.set", Pos: []string{"app", "capability", "audience", "value"}, Confirm: true},
	{JS: "llm.list", Verb: "llm.ls"},
	{JS: "llm.usage", Verb: "llm.usage", Pos: []string{"person"}},
	{JS: "llm.set", Verb: "llm.set", Pos: []string{"subject", "value", "budget"}, Confirm: true},
	{JS: "llm.remove", Verb: "llm.rm", Pos: []string{"subject"}, Confirm: true},
	{JS: "llm.reset", Verb: "llm.reset", Pos: []string{"person"}, Confirm: true},
	{JS: "subs.list", Verb: "sub.ls", Pos: []string{"person"}},
	{JS: "subs.grant", Verb: "sub.grant", Pos: []string{"person", "until", "note"}, Confirm: true},
	{JS: "subs.revoke", Verb: "sub.revoke", Pos: []string{"id"}, Confirm: true},
	{JS: "secrets.list", Verb: "secret.ls", Pos: []string{"app"}},
	{JS: "secrets.set", Verb: "secret.set", Pos: []string{"app", "name", "value"}, Confirm: true},
	{JS: "secrets.remove", Verb: "secret.rm", Pos: []string{"app", "name"}, Confirm: true},
	{JS: "stores.list", Verb: "store.ls", Fixed: map[string]any{"all": true}},
	{JS: "stores.meta", Verb: "store.meta", Pos: []string{"id"}},
	{JS: "apps.list", Verb: "app.ls"},
	{JS: "apps.status", Verb: "app.status", Pos: []string{"store"}},
	{JS: "apps.logs", Verb: "app.logs", Pos: []string{"store"}},
	{JS: "apps.restart", Verb: "app.restart", Pos: []string{"store"}},
	{JS: "apps.modules", Verb: "app.modules", Pos: []string{"app"}},
	{JS: "explain", Verb: "explain.can", Pos: []string{"store", "level", "subject"}},
	{JS: "log", Verb: "log.system", Pos: []string{"limit"}},
	{JS: "hosts", Verb: "server.hosts"},
}

// systemModule is use('system'): systemFuncs, plus call(verb, args) for
// code that names verbs (the back office's API client). call accepts only
// the verbs above.
func (s *Server) systemModule(a *actor.Actor) goja.Value {
	o := s.verbModule(a, systemFuncs).(*goja.Object)
	byVerb := map[string]modFunc{}
	for _, f := range systemFuncs {
		if _, dup := byVerb[f.Verb]; !dup {
			byVerb[f.Verb] = modFunc{JS: "call", Verb: f.Verb, Confirm: f.Confirm}
		}
	}
	_ = o.Set("call", func(verb string, args goja.Value) goja.Value {
		f, ok := byVerb[verb]
		if !ok {
			a.Throw("permission_denied", "system.call: "+verb+" is not in the system module")
		}
		in, _ := a.FromJS(args).(map[string]any)
		if in == nil {
			in = map[string]any{}
		}
		return s.callVerb(a, f, in)
	})
	return o
}
