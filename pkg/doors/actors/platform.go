package actors

import (
	"context"
	"slices"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// platformOps maps app.json slop.platform entries to the verbs they call.
var platformOps = map[string]string{"stores.create": "store.new", "mounts.set": "mount.set", "grants.set": "grant.set"}

// platformModule is use('platform') in actors: an app that creates stores,
// sets mounts or grants. Each call needs the operation listed in app.json
// slop.platform and the policy on for the visitor's audience, and runs as
// the visitor (the store itself for alarms and reactors) through the verb
// of the same meaning, so it can do only what they could.
func (s *Door) platformModule(a *actor.Actor) goja.Value {
	vm := a.VM()
	listed := a.Manifest().Slop.Platform
	op := func(name string) func(goja.Value) goja.Value {
		return func(arg goja.Value) goja.Value {
			a.Need("platform")
			if !slices.Contains(listed, name) {
				a.Throw("permission_denied", name+" is not in app.json slop.platform")
			}
			v := a.Visitor()
			ctx := context.Background()
			var p *access.Principal
			if id, ok := strings.CutPrefix(v.ID, "store:"); ok {
				// Nobody behind the call (an alarm, a reactor, another
				// store): the store acts as itself, holding only what was
				// granted to store:<id> (SLOP3-007), never its owner.
				p = &access.Principal{Kind: access.KindStore, Store: id, Via: "app:" + a.App()}
			} else {
				if v.Payer == "" {
					a.Throw("permission_denied", "a visitor without an id cannot use the platform")
				}
				if p = s.Web.PersonAs(ctx, v.Payer, "app:"+a.App()); p == nil {
					a.Throw("permission_denied", "no person to act as")
				}
			}
			args, _ := a.FromJS(arg).(map[string]any)
			if args == nil {
				args = map[string]any{}
			}
			out, err := s.Verbs.Call(web.WithPrincipal(ctx, p), p, platformOps[name], args)
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
