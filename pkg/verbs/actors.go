package verbs

import (
	"context"
	"errors"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/actor"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/system"
)

func actorErr(err error) error {
	var ae *actor.Error
	if errors.As(err, &ae) {
		return &Error{Code: ae.Code, Message: ae.Message}
	}
	return err
}

func init() {
	storeArg := Arg{Name: "store", Type: "string", Pos: 1, Required: true}
	Register(
		&Verb{Name: "actor.call", Doc: "Call an action of a store's actor (the action checks your level itself).", Scope: Write,
			Args: []Arg{storeArg, {Name: "action", Type: "string", Pos: 2, Required: true}, {Name: "args", Type: "json"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "calling"); err != nil {
					return nil, err
				}
				var args any = map[string]any{}
				if a.Has("args") {
					args = norm(a["args"])
					if s, ok := a["args"].(string); ok {
						args = decodeJSON([]byte(s))
					}
				}
				v, err := e.A.Call(ctx, a.S("store"), a.S("action"), args, e.A.VisitorOf(ctx, p, a.S("store")), p.ViaLabel())
				return v, actorErr(err)
			}},
		&Verb{Name: "app.logs", Doc: "The recent log of a store's actor (console.log, ctx.log).", Scope: Read,
			Args: []Arg{storeArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "reading the actor log"); err != nil {
					return nil, err
				}
				out := map[string]any{"lines": e.A.Logs(ctx, a.S("store"))}
				if b := e.A.Broken(a.S("store")); b != "" {
					out["broken"] = b
				}
				return out, nil
			}},
		&Verb{Name: "app.restart", Doc: "Restart a store's actor: clears a broken state and retries activation.", Scope: Write,
			Args: []Arg{storeArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "restarting"); err != nil {
					return nil, err
				}
				e.A.Restart(a.S("store"))
				r, err := e.K.Running(ctx, a.S("store"))
				if err != nil {
					return nil, err
				}
				return map[string]any{"store": r.Store, "app": r.App, "n": r.N, "broken": r.Broken}, nil
			}},
		&Verb{Name: "alarm.ls", Doc: "List a store's alarms.", Scope: Read,
			Args: []Arg{storeArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "reading alarms")
				if err != nil {
					return nil, err
				}
				return s.ReadQuery(ctx, `SELECT name, at, every, running FROM _alarms ORDER BY at`)
			}},
		&Verb{Name: "alarm.fire", Doc: "Fire a store's alarm now.", Scope: Write,
			Args: []Arg{storeArg, {Name: "name", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "firing alarms"); err != nil {
					return nil, err
				}
				return map[string]any{"fired": a.S("name")}, actorErr(e.A.Fire(ctx, a.S("store"), a.S("name")))
			}},
		&Verb{Name: "bind.ls", Doc: "List a store's read aliases.", Scope: Read,
			Args: []Arg{storeArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading"); err != nil {
					return nil, err
				}
				return e.Sys.Bindings(ctx, a.S("store"))
			}},
		&Verb{Name: "bind.set", Doc: "Point a store's read alias at another store (grant store:<store> view there for actors).", Scope: Write,
			Args: []Arg{storeArg, {Name: "alias", Type: "string", Pos: 2, Required: true}, {Name: "target", Type: "string", Pos: 3, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "binding"); err != nil {
					return nil, err
				}
				if _, _, err := e.open(ctx, p, a.S("target"), rt.LevelView, "binding to"); err != nil {
					return nil, err
				}
				b := system.Binding{Store: a.S("store"), Alias: a.S("alias"), Target: a.S("target")}
				return b, e.Sys.SetBinding(ctx, p.ID(), p.ViaLabel(), b)
			}},
		&Verb{Name: "bind.rm", Doc: "Remove a store's read alias.", Scope: Write,
			Args: []Arg{storeArg, {Name: "alias", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "unbinding"); err != nil {
					return nil, err
				}
				err := e.Sys.RemoveBinding(ctx, p.ID(), p.ViaLabel(), a.S("store"), a.S("alias"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "no alias %s on %s", a.S("alias"), a.S("store"))
				}
				return map[string]any{"removed": a.S("alias")}, err
			}},
	)
}
