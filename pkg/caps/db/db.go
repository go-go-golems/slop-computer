// Package db is the db capability (SLOP3-009 step 4): one implementation of
// a viewer's db paths for every caller. A page's RPCs and an actor's
// use('db') both resolve a path through the viewer's rt.Space to a store, a
// path in it and a ceiling, and act on that store at min(the viewer's level
// there, the ceiling), under the rules of the app that store runs. The
// registry's documents (_stores, _people) come from a Registry the door
// provides.
//
// A viewer is an *rt.View: a page's view, or for an actor the event in
// progress as a view of its store by the event's visitor (Kind "actor", no
// stream). The package knows nothing of HTTP or goja.
package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Host is what the capability needs from the door that serves it.
type Host interface {
	// Viewer is the person behind a view, as they are known elsewhere (nil:
	// nobody, who holds what @guest is given).
	Viewer(ctx context.Context, v *rt.View) *access.Principal
}

// Registry serves the registry's documents (pkg/registry).
type Registry interface {
	Doc(ctx context.Context, v *rt.View, tgt rt.Target, path string) *rt.Doc
	Coll(ctx context.Context, v *rt.View, tgt rt.Target, coll string) []rt.Doc
	Write(ctx context.Context, v *rt.View, tgt rt.Target, in WriteIn) (int64, error)
}

// DB is the capability.
type DB struct {
	K    *kernel.Kernel
	Host Host
	Reg  Registry // nil: the registry's documents are missing
}

// Error is a refused call, with a contract error code (and for
// confirmation_required the confirmation's id).
type Error struct{ Code, Message, Confirm string }

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func errf(code, format string, args ...any) error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// pathFail turns a space's refusal into an Error.
func pathFail(err error) error {
	var pe *rt.PathError
	if errors.As(err, &pe) {
		return &Error{Code: pe.Code, Message: pe.Msg}
	}
	return err
}

// Space is the path space of a view of storeID running an app with caps:
// the store's aliases that map into its pages (bindings with a prefix), and
// _stores when the app declares capabilities.db.stores and stores is true
// (the policy allows it for this viewer).
func (d *DB) Space(ctx context.Context, storeID string, caps rt.Caps, stores bool) *rt.Space {
	sp := &rt.Space{Holder: storeID, Aliases: map[string]rt.Alias{}}
	if caps.Stores != rt.LevelNone && stores {
		sp.Stores = caps.Stores
	}
	bs, err := d.K.Registry.Bindings(ctx, storeID)
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

// Route is a resolved path: the store holding the document, its path
// there, the viewer's effective level on it and that store's rules.
type Route struct {
	Tgt   rt.Target
	St    *store.Store
	Level rt.Level
	Held  rt.Level // the viewer's own level on the store, before the route's ceiling
	Rules rt.Rules
	Found bool // another store that exists, whether or not the viewer may read it
}

// CanRead reports whether the route's viewer may read path in its store.
func (r Route) CanRead(path, user string) bool {
	return r.Level != rt.LevelNone && r.Rules.CanRead(path, user, r.Level)
}

// CanWrite reports whether the route's viewer may write path in its store.
func (r Route) CanWrite(path, user string) bool {
	return r.Level != rt.LevelNone && r.Rules.CanWrite(path, user, r.Level)
}

// Route resolves a path of v (a document if doc, else a collection). For
// the registry's documents it returns the target with no store; for
// another store's private documents, nothing (reads find nothing, writes
// are refused).
func (d *DB) Route(ctx context.Context, v *rt.View, path string, doc bool) (Route, error) {
	tgt, err := v.Space.Resolve(path, doc)
	var pe *rt.PathError
	if errors.As(err, &pe) && pe.Code == "not_found" {
		return Route{}, nil
	}
	if err != nil {
		return Route{}, pathFail(err)
	}
	if tgt.Registry {
		return Route{Tgt: tgt}, nil
	}
	if tgt.Store == "" {
		tgt.Store = v.Target // a view without a space (nil): its own store
	}
	if tgt.Own {
		st, err := d.K.Store(ctx, v.Target)
		if err != nil {
			return Route{}, err
		}
		return Route{Tgt: tgt, St: st, Level: min(v.Level, tgt.Cap), Rules: v.Caps.Rules}, nil
	}
	return d.remote(ctx, v, tgt)
}

// remote is another store's side of a route: the viewer's level there (as
// for opening it), capped by the route; LevelNone when they hold none or
// the store is gone.
func (d *DB) remote(ctx context.Context, v *rt.View, tgt rt.Target) (Route, error) {
	r := Route{Tgt: tgt}
	row, err := d.K.Registry.StoreByID(ctx, tgt.Store)
	if errors.Is(err, sysdb.ErrNotFound) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	r.Found = true
	r.Held = d.K.Access.Level(ctx, d.Host.Viewer(ctx, v), row).Level
	r.Level = min(r.Held, tgt.Cap)
	if r.Level == rt.LevelNone {
		return r, nil
	}
	if r.St, err = d.K.Store(ctx, tgt.Store); err != nil {
		return r, err
	}
	r.Rules = d.K.Rules(ctx, tgt.Store)
	return r, nil
}

// LevelOn is the viewer's own level on another store (LevelNone when it is
// gone).
func (d *DB) LevelOn(ctx context.Context, v *rt.View, storeID string) rt.Level {
	row, err := d.K.Registry.StoreByID(ctx, storeID)
	if err != nil {
		return rt.LevelNone
	}
	return d.K.Access.Level(ctx, d.Host.Viewer(ctx, v), row).Level
}

// PagePath is where a document of a route's collection shows in the
// viewer's space: the page's collection and the document's id (an alias
// maps a collection to a collection, so ids are the same).
func PagePath(pageColl, docPath string) string { return pageColl + "/" + rt.IDOf(docPath) }

// Get reads one document at a path of v, wherever it lives. A document the
// viewer may not read, in any store, is missing (false).
func (d *DB) Get(ctx context.Context, v *rt.View, path string) (rt.Doc, bool, error) {
	r, err := d.Route(ctx, v, path, true)
	if err != nil {
		return rt.Doc{}, false, err
	}
	if r.Tgt.Registry {
		if d.Reg == nil {
			return rt.Doc{}, false, nil
		}
		if doc := d.Reg.Doc(ctx, v, r.Tgt, path); doc != nil {
			return rt.Doc{Path: path, Version: doc.Version, Body: doc.Body}, true, nil
		}
		return rt.Doc{}, false, nil
	}
	if r.St == nil {
		return rt.Doc{}, false, nil // no access
	}
	doc, err := r.St.GetDoc(ctx, r.Tgt.Path, func(p string) bool { return r.CanRead(p, v.User) })
	if errors.Is(err, store.ErrNotFound) {
		return rt.Doc{}, false, nil
	}
	if err != nil {
		return rt.Doc{}, false, err
	}
	return rt.Doc{Path: path, Version: doc.Version, Body: doc.Body}, true, nil
}

// Query runs q (on a collection of v's space) over the documents the
// viewer may read in the store the collection lives in, with v's paths.
func (d *DB) Query(ctx context.Context, v *rt.View, q rt.Query) ([]rt.Doc, error) {
	r, err := d.Route(ctx, v, q.Coll, false)
	if err != nil {
		return nil, err
	}
	if r.Tgt.Registry {
		var docs []rt.Doc
		if d.Reg != nil {
			docs = d.Reg.Coll(ctx, v, r.Tgt, q.Coll)
		}
		if docs == nil {
			docs = []rt.Doc{}
		}
		return q.Apply(docs), nil
	}
	if r.St == nil {
		return []rt.Doc{}, nil
	}
	pageColl := q.Coll
	q.Coll = r.Tgt.Path
	docs, err := r.St.Query(ctx, q, func(p string) bool { return r.CanRead(p, v.User) })
	if err != nil {
		return nil, errf("invalid_argument", "invalid query on %q", pageColl)
	}
	out := make([]rt.Doc, 0, len(docs))
	for _, doc := range docs {
		out = append(out, rt.Doc{Path: PagePath(pageColl, doc.Path), Body: doc.Body, Version: doc.Version})
	}
	return out, nil
}

// WriteIn is one db write.
type WriteIn struct {
	Path      string          `json:"path"`
	Op        string          `json:"op"` // set | update | patch | delete
	Body      json.RawMessage `json:"body,omitempty"`
	Patch     *rt.Patch       `json:"patch,omitempty"`
	Base      int64           `json:"base,omitempty"`
	IfVersion *int64          `json:"ifVersion,omitempty"`
}

// WriteRoute resolves a path for a write: the registry's documents are
// written through Write, and the viewer must be allowed to write it.
func (d *DB) WriteRoute(ctx context.Context, v *rt.View, path string) (Route, error) {
	r, err := d.Route(ctx, v, path, true)
	if err != nil {
		return Route{}, err
	}
	if r.Tgt.Registry {
		return Route{}, errf("invalid_argument", "the registry's documents are not writable (yet)")
	}
	if r.St == nil || !r.CanWrite(r.Tgt.Path, v.User) {
		return Route{}, errf("invalid_argument", "this viewer cannot write %q", path)
	}
	return r, nil
}

// Who is who a write through r commits as: who, at the viewer's level on
// the store written.
func Who(who store.Who, r Route) store.Who {
	who.Level = r.Level.String()
	return who
}

// Write validates and commits one write as one turn of the store the path
// lives in, as who, or runs the registry verb a registry document's write
// stands for. It returns the document's version and the store's rev.
func (d *DB) Write(ctx context.Context, v *rt.View, who store.Who, in WriteIn) (int64, int64, error) {
	if r, err := d.Route(ctx, v, in.Path, true); err == nil && r.Tgt.Registry {
		if d.Reg == nil {
			return 0, 0, errf("invalid_argument", "the registry's documents are not served here")
		}
		version, err := d.Reg.Write(ctx, v, r.Tgt, in)
		return version, 0, err
	}
	r, err := d.WriteRoute(ctx, v, in.Path)
	if err != nil {
		return 0, 0, err
	}
	var body map[string]any
	switch in.Op {
	case "set", "update":
		b, err := rt.ParseBody(in.Body)
		if err != nil {
			return 0, 0, errf("invalid_argument", "%v", err)
		}
		body = b
	case "patch":
		if in.Patch == nil {
			return 0, 0, errf("invalid_argument", "a patch write needs a patch")
		}
	case "delete":
	default:
		return 0, 0, errf("invalid_argument", "unknown write %q", in.Op)
	}
	path := r.Tgt.Path
	var version int64
	c, err := r.St.Do(ctx, Who(who, r), func(t *store.Turn) error {
		cur, err := t.GetDoc(path)
		exists := err == nil
		if err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
		if in.IfVersion != nil {
			have := int64(0)
			if exists {
				have = cur.Version
			}
			if have != *in.IfVersion {
				return errf("conflict", "the document is at version %d, not %d", have, *in.IfVersion)
			}
		}
		switch in.Op {
		case "set":
			version, err = t.SetDoc(path, body, 0)
		case "update":
			if !exists {
				return errf("invalid_argument", "update needs an existing document at %q", in.Path)
			}
			version, err = t.UpdateDoc(path, body)
		case "patch":
			if !exists || cur.Version != in.Base {
				return errf("conflict_base", "the document moved past version %d", in.Base)
			}
			old := any(cur.Body)
			b, _ := json.Marshal(old)
			_ = json.Unmarshal(b, &old) // patches apply to plain JSON values
			next, perr := rt.Apply(old, *in.Patch)
			m, ok := next.(map[string]any)
			if perr != nil || !ok {
				return errf("conflict_base", "the patch does not apply")
			}
			version, err = t.SetDoc(path, m, 0)
		case "delete":
			_, err = t.DeleteDoc(path)
		}
		return err
	})
	if err != nil {
		return 0, 0, StoreFail(err)
	}
	var rev int64
	if c != nil {
		rev = c.Rev
	}
	return version, rev, nil
}

// StoreFail is a store's refusal of a write as an Error.
func StoreFail(err error) error {
	var e *Error
	var de *store.DocError
	switch {
	case errors.As(err, &e):
		return e
	case errors.As(err, &de) && strings.HasPrefix(de.Msg, "quota_exceeded"):
		return errf("quota_exceeded", "this database holds at most %d documents", rt.MaxDocsPerTarget)
	case errors.As(err, &de):
		return errf("invalid_argument", "%s", de.Msg)
	}
	return err
}

// Reader is how a stream reads one store's commits for a view: its rules
// and the viewer's level there, decided once per commit.
type Reader struct {
	Store string
	Own   bool
	Level rt.Level
	Rules rt.Rules
}

// ReaderFor is v's reader of storeID.
func (d *DB) ReaderFor(ctx context.Context, v *rt.View, storeID string) Reader {
	if storeID == v.Target {
		return Reader{Store: storeID, Own: true, Level: v.Level, Rules: v.Caps.Rules}
	}
	r, err := d.remote(ctx, v, rt.Target{Store: storeID, Cap: rt.LevelOwner})
	if err != nil {
		return Reader{Store: storeID}
	}
	return Reader{Store: storeID, Level: r.Level, Rules: r.Rules}
}

// PagePaths are the paths of v that show one committed document of r's
// store at path and that v subscribed to (wants), each readable at the
// route's ceiling.
func (r Reader) PagePaths(v *rt.View, path string, wants func(string) bool) []string {
	if r.Level == rt.LevelNone {
		return nil
	}
	var out []string
	for _, pp := range v.Space.PagePaths(r.Store, path) {
		if !wants(pp) {
			continue
		}
		tgt, err := v.Space.Resolve(pp, true)
		if err != nil || tgt.Store != r.Store || tgt.Path != path {
			continue
		}
		if !r.Rules.CanRead(path, v.User, min(r.Level, tgt.Cap)) {
			continue
		}
		out = append(out, pp)
	}
	return out
}
