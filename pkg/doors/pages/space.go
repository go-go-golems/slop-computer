package pages

// The path space in the page protocol (SLOP3-008): a page's db paths are
// resolved by its view's rt.Space; pkg/caps/db (SLOP3-009 step 4) does the
// resolving, reading and writing, for pages and actors alike. This file is
// the page door's side: the server as the capability's host, and the
// stream's view of other stores.

import (
	"context"
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/access"
	capsdb "github.com/go-go-golems/slop-computer/pkg/caps/db"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// dbHost is the server as the db capability's Host and Registry.
type dbHost struct{ s *Door }

// Viewer is a view's person; an actor's view is its event's visitor.
func (h dbHost) Viewer(ctx context.Context, v *rt.View) *access.Principal {
	return h.s.viewPrincipal(ctx, v)
}

func (h dbHost) Doc(ctx context.Context, v *rt.View, tgt rt.Target, path string) *rt.Doc {
	return h.s.reg.Doc(ctx, v, tgt, path)
}

func (h dbHost) Coll(ctx context.Context, v *rt.View, tgt rt.Target, coll string) []rt.Doc {
	return h.s.reg.Coll(ctx, v, tgt, coll)
}

func (h dbHost) Write(ctx context.Context, v *rt.View, tgt rt.Target, in capsdb.WriteIn) (int64, error) {
	if v.Kind == rt.KindActor {
		return 0, &capsdb.Error{Code: "permission_denied", Message: "an actor cannot write the registry's documents"}
	}
	return h.s.reg.Write(ctx, v, tgt, registry.WriteIn{Op: in.Op, Body: in.Body, IfVersion: in.IfVersion})
}

// dbErr is the db capability's (or the registry's) refusal as the
// runtime's error.
func dbErr(err error) error {
	var e *capsdb.Error
	if errors.As(err, &e) {
		return &rtFail{Code: e.Code, Message: e.Message, Confirm: e.Confirm}
	}
	return regErr(err)
}

// route resolves a page path of v.
func (s *Door) route(ctx context.Context, v *rt.View, path string, doc bool) (capsdb.Route, error) {
	r, err := s.db.Route(ctx, v, path, doc)
	return r, dbErr(err)
}

// remoteLevelsMoved reports whether the viewer's level on a store v
// follows is no longer the one it had when v started following it: the
// documents the page shows from there may be ones it can no longer see.
func (s *Door) remoteLevelsMoved(ctx context.Context, v *rt.View) bool {
	for storeID, was := range v.RemoteLevels() {
		if s.db.LevelOn(ctx, v, storeID) != was {
			return true
		}
	}
	return false
}

// pageDocs maps one committed document of r's store to the page paths that
// show it and that v subscribed to.
func pageDocs(r capsdb.Reader, v *rt.View, path string, out docOut) []docOut {
	var docs []docOut
	for _, pp := range r.PagePaths(v, path, v.Wants) {
		o := out
		o.Path = pp
		docs = append(docs, o)
	}
	return docs
}

// assetStores are the stores a sandbox origin's pages may show uploads of
// by bare id, after its own: the targets of its aliases that share uploads.
func (s *Door) assetStores(ctx context.Context, storeID string) []string {
	return s.db.Space(ctx, storeID, rt.Caps{}, false).AssetStores()
}
