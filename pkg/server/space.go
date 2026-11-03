package server

// The path space in the page protocol (SLOP3-008): a page's db paths are
// resolved by its view's rt.Space to a store, a path in it and a ceiling;
// the viewer acts on that store at min(their level there, the ceiling),
// under the rules of the app that store runs.

import (
	"context"
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// spaceOf is the path space of a view of storeID running an app with caps,
// for a viewer with the policy cells pol: the store's aliases that map into
// its pages (bindings with a prefix), and _stores when the app declares
// capabilities.db.stores and the policy allows it for this viewer.
func (s *Server) spaceOf(ctx context.Context, storeID string, caps rt.Caps, pol map[string]bool) *rt.Space {
	sp := &rt.Space{Holder: storeID, Aliases: map[string]rt.Alias{}}
	if caps.Stores != rt.LevelNone && pol["stores"] {
		sp.Stores = caps.Stores
	}
	bs, err := s.Sys.Bindings(ctx, storeID)
	if err != nil {
		return sp
	}
	for _, b := range bs {
		if b.Prefix == "" || rt.ValidAlias(b.Alias, b.Prefix) != nil {
			continue // a read alias for the actor and slop.stores only
		}
		l, ok := rt.ParseLevel(b.Level)
		if !ok || l < rt.LevelView || l > rt.LevelAdmin {
			l = rt.LevelView
		}
		sp.Aliases[b.Alias] = rt.Alias{Name: b.Alias, Store: b.Target, Prefix: b.Prefix, Level: l, Assets: b.Assets}
	}
	return sp
}

// route is a resolved page path: the store holding the document, its path
// there, the viewer's effective level on it and that store's rules.
type route struct {
	tgt   rt.Target
	st    *store.Store
	level rt.Level
	held  rt.Level // the viewer's own level on the store, before the route's ceiling
	rules rt.Rules
	found bool // another store that exists, whether or not the viewer may read it
}

func (r route) canRead(path, user string) bool {
	return r.level != rt.LevelNone && r.rules.CanRead(path, user, r.level)
}

func (r route) canWrite(path, user string) bool {
	return r.level != rt.LevelNone && r.rules.CanWrite(path, user, r.level)
}

// pageFail turns a space's refusal into the runtime's error.
func pageFail(err error) error {
	var pe *rt.PathError
	if errors.As(err, &pe) {
		return rtErr(pe.Code, "%s", pe.Msg)
	}
	return err
}

// route resolves a page path of v. For the registry's documents (_stores,
// _stores/<id>: phase 3) it returns the target with no store.
func (s *Server) route(ctx context.Context, v *rt.View, path string, doc bool) (route, error) {
	tgt, err := v.Space.Resolve(path, doc)
	var pe *rt.PathError
	if errors.As(err, &pe) && pe.Code == "not_found" {
		return route{}, nil // hidden (another store's private documents): reads find nothing, writes are refused
	}
	if err != nil {
		return route{}, pageFail(err)
	}
	if tgt.Registry {
		return route{tgt: tgt}, nil
	}
	if tgt.Store == "" {
		tgt.Store = v.Target // a view without a space (nil): its own store
	}
	if tgt.Own {
		st, err := s.viewStore(ctx, v)
		if err != nil {
			return route{}, err
		}
		return route{tgt: tgt, st: st, level: min(v.Level, tgt.Cap), rules: v.Caps.Rules}, nil
	}
	return s.remoteRoute(ctx, v, tgt)
}

// remoteRoute is another store's side of a route: the viewer's level there
// (as for opening it), capped by the route; LevelNone when they hold none
// or the store is gone, so reads find nothing and writes are refused.
func (s *Server) remoteRoute(ctx context.Context, v *rt.View, tgt rt.Target) (route, error) {
	r := route{tgt: tgt}
	row, err := s.Sys.StoreByID(ctx, tgt.Store)
	if errors.Is(err, system.ErrNotFound) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	r.found = true
	d := s.Env.K.Access.Level(ctx, s.viewPrincipal(ctx, v), row)
	r.held = d.Level
	r.level = min(d.Level, tgt.Cap)
	if r.level == rt.LevelNone {
		return r, nil
	}
	if r.st, err = s.Env.K.Store(ctx, tgt.Store); err != nil {
		return r, err
	}
	r.rules = s.Env.K.Rules(ctx, tgt.Store)
	return r, nil
}

// remoteLevelsMoved reports whether the viewer's level on a store v
// follows is no longer the one it had when v started following it: the
// documents the page shows from there may be ones it can no longer see.
func (s *Server) remoteLevelsMoved(ctx context.Context, v *rt.View) bool {
	for storeID, was := range v.RemoteLevels() {
		now := rt.LevelNone
		if row, err := s.Sys.StoreByID(ctx, storeID); err == nil {
			now = s.Env.K.Access.Level(ctx, s.viewPrincipal(ctx, v), row).Level
		}
		if now != was {
			return true
		}
	}
	return false
}

// pagePath is where a document of the route's collection shows in the
// page: the page's collection and the document's id (an alias maps a
// collection to a collection, so ids are the same).
func pagePath(pageColl, docPath string) string { return pageColl + "/" + rt.IDOf(docPath) }

// storeReader is how a stream reads one store's commits for a view: its
// rules and the viewer's level there, decided once per commit.
type storeReader struct {
	store string
	own   bool
	level rt.Level
	rules rt.Rules
}

func (s *Server) readerFor(ctx context.Context, v *rt.View, storeID string) storeReader {
	if storeID == v.Target {
		return storeReader{store: storeID, own: true, level: v.Level, rules: v.Caps.Rules}
	}
	r, err := s.remoteRoute(ctx, v, rt.Target{Store: storeID, Cap: rt.LevelOwner})
	if err != nil {
		return storeReader{store: storeID}
	}
	return storeReader{store: storeID, level: r.level, rules: r.rules}
}

// pageDocs maps one committed document of r's store to the page paths that
// show it and that v subscribed to, each at the route's ceiling.
func (r storeReader) pageDocs(v *rt.View, path string, out docOut) []docOut {
	if r.level == rt.LevelNone {
		return nil
	}
	var docs []docOut
	for _, pp := range v.Space.PagePaths(r.store, path) {
		if !v.Wants(pp) {
			continue
		}
		tgt, err := v.Space.Resolve(pp, true)
		if err != nil || tgt.Store != r.store || tgt.Path != path {
			continue
		}
		level := min(r.level, tgt.Cap)
		if !r.rules.CanRead(path, v.User, level) {
			continue
		}
		o := out
		o.Path = pp
		docs = append(docs, o)
	}
	return docs
}

// assetStores are the stores a sandbox origin's pages may show uploads of
// by bare id, after its own: the targets of its aliases that share uploads.
func (s *Server) assetStores(ctx context.Context, storeID string) []string {
	return s.spaceOf(ctx, storeID, rt.Caps{}, nil).AssetStores()
}
