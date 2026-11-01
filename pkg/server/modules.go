package server

import (
	"context"
	"strings"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/actor"
	"github.com/go-go-golems/slop/pkg/verbs"
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
	Confirm bool           // governance: the person confirms it in the shell (W6)
}

// registerModules puts the server's Go modules in the actor registry.
func (s *Server) registerModules() {
	s.Env.A.Trusted = s.Sys.Trusted
	s.Env.A.Register(actor.Module{Name: "system", Doc: "People, grants, links, mounts, policy, LLM budgets, comps, secrets and the system log, as the visitor.",
		Load: s.systemModule})
}

// verbModule builds a module's object from its functions.
func (s *Server) verbModule(a *actor.Actor, funcs []modFunc) goja.Value {
	vm := a.VM()
	o := vm.NewObject()
	for _, f := range funcs {
		f := f
		fn := func(call goja.FunctionCall) goja.Value {
			return s.callVerb(a, f, modArgs(a, f, call.Arguments))
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
func (s *Server) callVerb(a *actor.Actor, f modFunc, args map[string]any) goja.Value {
	name := f.Verb
	v, ok := verbs.Get(name)
	if !ok {
		a.Throw("not_found", "no verb "+name)
	}
	p := s.actAs(a, v.Scope != verbs.Read)
	return a.IO(func() (any, error) {
		out, err := verbs.Call(withPrincipal(context.Background(), p), s.Env, p, name, args)
		if err != nil {
			ve := verbs.AsError(err)
			return nil, &actor.Error{Code: ve.Code, Message: ve.Message}
		}
		return out, nil
	}, func(out any) (goja.Value, error) { return a.ToJS(out), nil })
}

// actAs is the principal a module call runs as: the person behind the
// event, with their token's scopes if they came with one, labelled
// app:<app>. Reactors and alarms have nobody behind them: they may read,
// as the store's owner, but never write.
func (s *Server) actAs(a *actor.Actor, write bool) *access.Principal {
	v := a.Visitor()
	person := v.ID
	if strings.HasPrefix(person, "store:") {
		if write {
			a.Throw("permission_denied", "a module write needs a person; reactors, alarms and other stores may only read")
		}
		person = v.Payer
	}
	if person == "" {
		a.Throw("permission_denied", "no person to act as")
	}
	pp, err := s.Sys.Person(context.Background(), person)
	if err != nil {
		a.Throw("permission_denied", "no person to act as")
	}
	p := &access.Principal{Kind: access.KindUser, Person: &pp, Via: "app:" + a.App()}
	if pp.Kind == "guest" {
		p.Kind = access.KindGuest
	}
	if v.Scopes != nil {
		p.Kind, p.Scopes = access.KindToken, v.Scopes
	}
	return p
}
