package server

import (
	"context"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Verb-backed Go modules (SLOP3-002). A module function is a named verb
// call made as the event's visitor: the verb applies its ordinary checks
// to that person, and the system log records via app:<app>. Functions
// return promises, so no verb runs while the turn holds its transaction.

// A modFunc is one function of a verb-backed module.
type modFunc struct {
	JS      string         // group.name in JavaScript ("people.setRole")
	Verb    string         // the verb it calls
	Pos     []string       // the verb arguments positional parameters fill
	Fixed   map[string]any // arguments always passed
	Default map[string]any // arguments passed unless given
	Confirm bool           // governance: the person confirms it in the shell (W6)
}

// registerModules puts the server's Go modules in the actor registry.
func (s *Server) registerModules() {
	s.Env.A.Trusted = s.Sys.Trusted
	s.Env.A.Register(actor.Module{Name: "system", Doc: "People, grants, links, mounts, policy, LLM budgets, comps, secrets and the system log, as the visitor.",
		Load: s.systemModule})
	s.Env.A.Register(actor.Module{Name: "workshop", Doc: "Stores, snapshots, refs and files of any store the visitor may read; push to draft, publish, run drafts.",
		Load: func(a *actor.Actor) goja.Value { return s.verbModule(a, "workshop", workshopFuncs) }})
}

// verbModule builds a module's object from its functions.
func (s *Server) verbModule(a *actor.Actor, module string, funcs []modFunc) goja.Value {
	vm := a.VM()
	o := vm.NewObject()
	for _, f := range funcs {
		f := f
		fn := func(call goja.FunctionCall) goja.Value {
			return s.callVerb(a, module, f, modArgs(a, f, call.Arguments))
		}
		target := o
		path := strings.Split(f.JS, ".")
		for _, seg := range path[:len(path)-1] {
			next, _ := target.Get(seg).(*goja.Object)
			if next == nil {
				next = vm.NewObject()
				_ = target.Set(seg, next)
			}
			target = next
		}
		_ = target.Set(path[len(path)-1], fn)
	}
	return o
}

// modArgs maps a call's arguments to verb arguments. One plain object is
// the argument object; otherwise arguments fill Pos in order, and a plain
// object after them adds options.
func modArgs(a *actor.Actor, f modFunc, in []goja.Value) map[string]any {
	out := map[string]any{}
	vals := make([]any, len(in))
	for i, v := range in {
		vals[i] = a.FromJS(v)
	}
	if obj, ok := single(vals); ok {
		for k, v := range obj {
			out[k] = v
		}
	} else {
		for i, v := range vals {
			switch {
			case i < len(f.Pos):
				if v != nil {
					out[f.Pos[i]] = v
				}
			case i == len(f.Pos):
				if opts, ok := v.(map[string]any); ok {
					for k, x := range opts {
						out[k] = x
					}
				}
			}
		}
	}
	for k, v := range f.Default {
		if _, ok := out[k]; !ok {
			out[k] = v
		}
	}
	for k, v := range f.Fixed {
		out[k] = v
	}
	return out
}

func single(vals []any) (map[string]any, bool) {
	if len(vals) != 1 {
		return nil, false
	}
	m, ok := vals[0].(map[string]any)
	return m, ok
}

// callVerb runs a module function's verb as the visitor and returns its
// promise.
func (s *Server) callVerb(a *actor.Actor, module string, f modFunc, args map[string]any) goja.Value {
	name := f.Verb
	v, ok := s.Verbs.Get(name)
	if !ok {
		a.Throw("not_found", "no verb "+name)
	}
	// The trust that let the app use() this module is checked again on every
	// call: it ends when it is withdrawn, or when the admin who made it is
	// no longer an admin (SLOP3-007), without waiting for a restart.
	if module != "" && !s.Sys.Trusted(context.Background(), a.App(), module) {
		a.Throw("permission_denied", a.App()+" is no longer trusted with "+module)
	}
	p := s.actAs(a, module, v.Scope != verbs.Read)
	confirm := f.Confirm || v.Effect == verbs.EffectGovern // the verb says, or the module function
	if confirm && p.Person == nil {
		a.Throw("permission_denied", name+" asks a person to confirm, and nobody is behind this call")
	}
	if confirm {
		// Refuse what the verb would refuse before asking anyone to allow it.
		if err := s.Verbs.Check(p, name, args); err != nil {
			ve := verbs.AsError(err)
			a.Throw(ve.Code, ve.Message)
		}
		title := a.App()
		if m := a.Manifest(); m != nil && m.Title != "" {
			title = m.Title
		}
		c, ok := s.Env.Confirm.Check(p.Person.ID, a.Visitor().View, a.App(), title, name, args)
		if !ok {
			a.ThrowError(&actor.Error{Code: "confirmation_required", Message: title + " asks to " + c.Summary, Confirm: c.ID})
		}
	}
	return a.IO(func() (any, error) {
		out, err := s.Verbs.Call(withPrincipal(context.Background(), p), p, name, args)
		if err != nil {
			ve := verbs.AsError(err)
			return nil, &actor.Error{Code: ve.Code, Message: ve.Message}
		}
		return out, nil
	}, func(out any) (goja.Value, error) { return a.ToJS(out), nil })
}

// actAs is the principal a module call runs as: the person behind the
// event, with their token's scopes if they came with one, labelled
// app:<app>. Reactors, alarms and other stores have nobody behind them:
// they act as the store itself (SLOP3-007), never as its owner, and may
// only read. The trust row that lets the app use the module admits the
// store (Principal.Trusted); it counts only while the admin who made it
// is still an admin.
func (s *Server) actAs(a *actor.Actor, module string, write bool) *access.Principal {
	v := a.Visitor()
	person := v.ID
	if id, ok := strings.CutPrefix(person, "store:"); ok {
		if write {
			a.Throw("permission_denied", "a module write needs a person; reactors, alarms and other stores may only read")
		}
		p := &access.Principal{Kind: access.KindStore, Store: id, Via: "app:" + a.App()}
		p.Trusted = module != "" && s.Sys.Trusted(context.Background(), a.App(), module)
		return p
	}
	if person == "" {
		a.Throw("permission_denied", "no person to act as")
	}
	p := s.personAs(context.Background(), person, "app:"+a.App())
	if p == nil {
		a.Throw("permission_denied", "no person to act as")
	}
	if v.Scopes != nil {
		p.Kind, p.Scopes = access.KindToken, v.Scopes
	}
	return p
}
