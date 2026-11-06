package actor

// Route policies at load (SLOP3-012 phase 3). An actor belongs to a store,
// and a store can be served by several mounts: the fixed mounts naming it
// and every :param mount whose type it has. A route key that no serving
// mount would serve is a load error, so an app that registers an endpoint
// its mounts do not allow fails visibly (app.status) instead of silently
// answering 404. The dispatch check in MatchRoute stays the authoritative
// one; this is the early, visible half.

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/registry"
)

// servingMounts are the mounts that can serve a store: those naming it,
// and :param mounts open to its type.
func (m *Manager) servingMounts(ctx context.Context, storeID, storeType string) ([]registry.Mount, error) {
	if m.K == nil || m.K.Registry == nil {
		return nil, nil
	}
	all, err := m.K.Registry.Mounts(ctx, "")
	if err != nil {
		return nil, err
	}
	var out []registry.Mount
	for _, mt := range all {
		if mt.Store == storeID || (mt.StoreParam != "" && (mt.Type == "" || mt.Type == storeType)) {
			out = append(out, mt)
		}
	}
	return out, nil
}

// checkRoutePolicies fails when a route key is in no serving mount's
// allowlist (a mount without an API policy serves every route).
func (a *Actor) checkRoutePolicies(ctx context.Context) error {
	keys := a.keys("http")
	if len(keys) == 0 {
		return nil
	}
	mounts, err := a.m.servingMounts(ctx, a.st.ID, a.st.Meta("type"))
	if err != nil || len(mounts) == 0 {
		return err // not mounted anywhere: nothing to enforce yet
	}
	for _, key := range keys {
		ok := false
		for _, mt := range mounts {
			if mt.API == nil || mt.API.AllowsKey(key) {
				ok = true
				break
			}
		}
		if !ok {
			where := make([]string, len(mounts))
			for i, mt := range mounts {
				where[i] = mt.Host + mt.Path
			}
			return fmt.Errorf("route %s is in no API allowlist of the mounts serving %s (%s)", key, a.st.ID, strings.Join(where, ", "))
		}
	}
	return nil
}

// Routes lists a store's actor routes, sorted by key, for review (the
// mount.routes verb). A store whose actor is broken by a route policy is
// built once more without the check, so its routes can still be listed;
// that build is thrown away.
func (m *Manager) Routes(ctx context.Context, storeID string) ([]Route, error) {
	a, err := m.Get(ctx, storeID)
	if err != nil {
		r, rerr := m.K.Running(ctx, storeID)
		if rerr != nil || r.Manifest == nil || r.Manifest.Actor == "" || (r.N > 0 && !r.Usable()) {
			return nil, err
		}
		files, ferr := m.appFiles(ctx, r.App, r.N)
		if ferr != nil {
			return nil, ferr
		}
		st, serr := m.K.Store(ctx, storeID)
		if serr != nil {
			return nil, serr
		}
		if a, err = build(ctx, m, st, r, files, false); err != nil {
			return nil, err
		}
	}
	if a == nil {
		return []Route{}, nil
	}
	out := make([]Route, 0, len(a.routes))
	for _, r := range a.routes {
		out = append(out, r)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out, nil
}
