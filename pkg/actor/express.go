package actor

// use('express') / require('express') (SLOP3-012 phase 2): the route
// builder is JavaScript (express.js), evaluated once per actor as
// storage.js is. Go keeps the part that must be checked: register records
// a route while actor.js loads, validating its key, level and audience,
// and mergeRoutes writes the routes into def.http before readShape, so
// MatchRoute, Serve, fn and toRes see one table and stay as they were.

import (
	_ "embed"
	"fmt"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

//go:embed express.js
var expressJS string

// pendingRoute is a route the builder registered during load.
type pendingRoute struct {
	key, level, audience string
	run                  goja.Value
}

// expressModule builds the module once per actor.
func (a *Actor) expressModule() goja.Value {
	if a.express != nil {
		return a.express
	}
	v, err := a.vm.RunString(expressJS)
	a.check(err)
	f, ok := goja.AssertFunction(v)
	if !ok {
		panic(a.vm.NewTypeError("express.js is not a function"))
	}
	out, err := f(goja.Undefined(), a.vm.ToValue(a.register))
	a.check(err)
	a.express = out
	return out
}

// register records one builder route; it throws unless actor.js is loading.
func (a *Actor) register(method, pattern, level, audience string, run goja.Value) {
	if !a.loading {
		a.throw(fail("invalid_state", "routes register only while actor.js loads"))
	}
	key := method + " " + pattern
	if !registry.ValidRouteKey(key) {
		a.throw(fail("invalid_argument", "%q is not a route: METHOD /path with literal, :name and a final * segments", key))
	}
	if err := checkRouteLevel(level); err != nil {
		a.throw(fail("invalid_argument", "%s: %v", key, err))
	}
	if audience != "" && !sysdb.ValidGroup(audience) {
		a.throw(fail("invalid_argument", "%s: unknown audience %q (guest, member, subscriber, admin)", key, audience))
	}
	for _, p := range a.pending {
		if p.key == key {
			a.throw(fail("invalid_argument", "%s is registered twice", key))
		}
	}
	a.pending = append(a.pending, pendingRoute{key: key, level: level, audience: audience, run: run})
}

// checkRouteLevel accepts the levels a route may name.
func checkRouteLevel(level string) error {
	if level == "public" {
		return nil
	}
	l, ok := rt.ParseLevel(level)
	if !ok || l == rt.LevelNone || l == rt.LevelSelf {
		return fmt.Errorf("level %q: use public, view, interact, admin or owner", level)
	}
	return nil
}

// mergeRoutes writes the builder's routes into def.http (creating it), so
// the definition holds one route table. A key both define is an error.
func (a *Actor) mergeRoutes() error {
	if len(a.pending) == 0 {
		return nil
	}
	h, _ := a.def.Get("http").(*goja.Object)
	if h == nil {
		h = a.vm.NewObject()
		if err := a.def.Set("http", h); err != nil {
			return err
		}
	}
	for _, p := range a.pending {
		if v := h.Get(p.key); v != nil && !goja.IsUndefined(v) {
			return fmt.Errorf("%s is defined both in http: and by express", p.key)
		}
		r := a.vm.NewObject()
		_ = r.Set("level", p.level)
		if p.audience != "" {
			_ = r.Set("audience", p.audience)
		}
		_ = r.Set("run", p.run)
		if err := h.Set(p.key, r); err != nil {
			return err
		}
	}
	a.pending = nil
	return nil
}
