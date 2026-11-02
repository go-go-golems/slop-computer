package server

import (
	"context"
	"slices"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// platformOps maps app.json slop.platform entries to the verbs they call.
var platformOps = map[string]string{"stores.create": "store.new", "mounts.set": "mount.set", "grants.set": "grant.set"}

// platformModule is use('platform') in actors: an app that creates stores,
// sets mounts or grants. Each call needs the operation listed in app.json
// slop.platform and the policy on for the visitor's audience, and runs as
// the visitor (the store's owner for alarms and reactors) through the verb
// of the same meaning, so it can do only what that person could.
func (s *Server) platformModule(a *actor.Actor) goja.Value {
	vm := a.VM()
	listed := a.Manifest().Slop.Platform
	op := func(name string) func(goja.Value) goja.Value {
		return func(arg goja.Value) goja.Value {
			a.Need("platform")
			if !slices.Contains(listed, name) {
				a.Throw("permission_denied", name+" is not in app.json slop.platform")
			}
			v := a.Visitor()
			if v.Payer == "" {
				a.Throw("permission_denied", "a visitor without an id cannot use the platform")
			}
			ctx := context.Background()
			p := s.personAs(ctx, v.Payer, "app:"+a.App())
			if p == nil {
				a.Throw("permission_denied", "no person to act as")
			}
			args, _ := a.FromJS(arg).(map[string]any)
			if args == nil {
				args = map[string]any{}
			}
			out, err := verbs.Call(withPrincipal(ctx, p), s.Env, p, platformOps[name], args)
			if err != nil {
				code, msg := "actor_error", err.Error()
				if ve, ok := err.(*verbs.Error); ok {
					code, msg = ve.Code, ve.Message
				}
				a.Throw(code, msg)
			}
			return a.ToJS(out)
		}
	}
	o := vm.NewObject()
	for name := range platformOps {
		group, fn, _ := strings.Cut(name, ".")
		g, _ := o.Get(group).(*goja.Object)
		if g == nil {
			g = vm.NewObject()
			_ = o.Set(group, g)
		}
		_ = g.Set(fn, op(name))
	}
	return o
}
