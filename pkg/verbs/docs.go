package verbs

import (
	"context"
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// MaxBatch is the most documents one docs.* call writes (in one turn).
const MaxBatch = 500

func init() {
	storeArg := Arg{Name: "store", Type: "string", Pos: 1, Required: true}
	Register(
		&Verb{Name: "docs.get", Doc: "Read one document.", Scope: Read, Action: authz.DocRead,
			Args: []Arg{storeArg, {Name: "path", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				s, d, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading")
				if err != nil {
					return nil, err
				}
				path := a.S("path")
				if !e.K.Rules(ctx, s.ID).CanRead(path, p.ID(), d.Level) {
					return nil, Errf("not_found", "no document %s", path)
				}
				doc, err := s.GetDoc(ctx, path)
				if errors.Is(err, store.ErrNotFound) {
					return nil, Errf("not_found", "no document %s", path)
				}
				return doc, err
			}},
		&Verb{Name: "docs.ls", Doc: "List a collection's documents.", Scope: Read, Action: authz.DocRead,
			Args: []Arg{storeArg, {Name: "coll", Type: "string", Pos: 2, Required: true}, {Name: "limit", Type: "int"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return queryDocs(ctx, e, p, a.S("store"), rt.Query{Coll: a.S("coll"), Limit: int(a.I("limit", 0))})
			}},
		&Verb{Name: "docs.query", Doc: "Query a collection: where [[field, op, value], …], orderBy, desc, limit.", Scope: Read, Action: authz.DocRead,
			Args: []Arg{storeArg, {Name: "coll", Type: "string", Pos: 2, Required: true},
				{Name: "where", Type: "json", Doc: `[["year", ">=", 2000]] or [{"field","op","value"}]`},
				{Name: "orderBy", Type: "string"}, {Name: "desc", Type: "bool"}, {Name: "limit", Type: "int"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				q := rt.Query{Coll: a.S("coll"), Order: a.S("orderBy"), Desc: a.B("desc"), Limit: int(a.I("limit", 0))}
				if a.Has("where") {
					ws, ok := a.list("where")
					if !ok {
						return nil, Errf("invalid_argument", "where is a list of [field, op, value]")
					}
					for _, w := range ws {
						f, ok := filterOf(w)
						if !ok {
							return nil, Errf("invalid_argument", "where is a list of [field, op, value]")
						}
						q.Filters = append(q.Filters, f)
					}
				}
				return queryDocs(ctx, e, p, a.S("store"), q)
			}},
		&Verb{Name: "docs.set", Doc: "Write whole documents: path and data, or batch [{path, data, ifVersion?}] in one commit.", Scope: Write, Action: authz.DocWrite,
			Args: []Arg{storeArg, {Name: "path", Type: "string", Pos: 2}, {Name: "data", Type: "json"},
				{Name: "ifVersion", Type: "int", Doc: "fail unless the document is at this version"},
				{Name: "batch", Type: "json", Doc: "[{path, data, ifVersion?}]"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return writeDocs(ctx, e, p, a, "set")
			}},
		&Verb{Name: "docs.update", Doc: "Deep-merge data into documents (creating them): path and data, or batch [{path, data}].", Scope: Write, Action: authz.DocWrite,
			Args: []Arg{storeArg, {Name: "path", Type: "string", Pos: 2}, {Name: "data", Type: "json"}, {Name: "batch", Type: "json"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return writeDocs(ctx, e, p, a, "update")
			}},
		&Verb{Name: "docs.rm", Doc: "Delete documents: path, or paths [..] in one commit.", Scope: Write, Action: authz.DocWrite,
			Args: []Arg{storeArg, {Name: "path", Type: "string", Pos: 2}, {Name: "paths", Type: "json"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				paths := a.Strings("paths")
				if a.S("path") != "" {
					paths = append(paths, a.S("path"))
				}
				items := make([]docItem, len(paths))
				for i, path := range paths {
					items[i] = docItem{Path: path}
				}
				return applyDocs(ctx, e, p, a.S("store"), items, "rm")
			}},
	)
}

func filterOf(w any) (rt.Filter, bool) {
	switch v := w.(type) {
	case []any:
		if len(v) != 3 {
			return rt.Filter{}, false
		}
		f, _ := v[0].(string)
		op, _ := v[1].(string)
		return rt.Filter{Field: f, Op: op, Value: v[2]}, f != "" && op != ""
	case map[string]any:
		f, _ := v["field"].(string)
		op, _ := v["op"].(string)
		return rt.Filter{Field: f, Op: op, Value: v["value"]}, f != "" && op != ""
	}
	return rt.Filter{}, false
}

func queryDocs(ctx context.Context, e *Env, p *access.Principal, id string, q rt.Query) (any, error) {
	s, d, err := e.open(ctx, p, id, rt.LevelView, "reading")
	if err != nil {
		return nil, err
	}
	// The read rules first, then the limit: a limit applied before them
	// would count documents this caller never sees.
	if err := q.Validate(); err != nil {
		return nil, Errf("invalid_argument", "invalid query on %q", q.Coll)
	}
	limit := q.Limit
	q.Limit = 0
	docs, err := s.Query(ctx, q)
	if err != nil {
		return nil, storeErr(err)
	}
	rules := e.K.Rules(ctx, s.ID)
	out := []store.Doc{}
	for _, doc := range docs {
		if limit > 0 && len(out) == limit {
			break
		}
		if rules.CanRead(doc.Path, p.ID(), d.Level) {
			out = append(out, doc)
		}
	}
	return out, nil
}

type docItem struct {
	Path      string
	Data      map[string]any
	IfVersion int64
}

func writeDocs(ctx context.Context, e *Env, p *access.Principal, a Args, op string) (any, error) {
	var items []docItem
	if a.Has("batch") {
		l, ok := a.list("batch")
		if !ok {
			return nil, Errf("invalid_argument", "batch is a list of {path, data}")
		}
		for _, x := range l {
			m, ok := x.(map[string]any)
			if !ok {
				return nil, Errf("invalid_argument", "batch is a list of {path, data}")
			}
			it := docItem{Path: Args(m).S("path"), IfVersion: Args(m).I("ifVersion", 0)}
			if it.Data, ok = Args(m).obj("data"); !ok {
				return nil, Errf("invalid_argument", "%s: data must be an object", it.Path)
			}
			items = append(items, it)
		}
	}
	if a.S("path") != "" {
		data, ok := a.obj("data")
		if !ok {
			return nil, Errf("invalid_argument", "data must be a JSON object")
		}
		items = append(items, docItem{Path: a.S("path"), Data: data, IfVersion: a.I("ifVersion", 0)})
	}
	return applyDocs(ctx, e, p, a.S("store"), items, op)
}

// applyDocs writes items in one turn after checking every path's rule.
func applyDocs(ctx context.Context, e *Env, p *access.Principal, id string, items []docItem, op string) (any, error) {
	if len(items) == 0 {
		return nil, Errf("invalid_argument", "nothing to write: give path and data, or batch")
	}
	if len(items) > MaxBatch {
		return nil, Errf("invalid_argument", "at most %d documents per call", MaxBatch)
	}
	s, d, err := e.open(ctx, p, id, rt.LevelView, "writing")
	if err != nil {
		return nil, err
	}
	rules := e.K.Rules(ctx, s.ID)
	for _, it := range items {
		if !rules.CanWrite(it.Path, p.ID(), d.Level) {
			if !rules.CanRead(it.Path, p.ID(), d.Level) {
				return nil, Errf("not_found", "no document %s", it.Path)
			}
			_, need := rules.Need(it.Path, p.ID())
			return nil, &Error{Code: "permission_denied", Message: "writing " + it.Path + " needs " + need.String(),
				Trace: append(d.Trace, "rule "+it.Path+": write needs "+need.String())}
		}
	}
	versions := map[string]int64{}
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		for _, it := range items {
			var v int64
			var err error
			switch op {
			case "set":
				v, err = t.SetDoc(it.Path, it.Data, it.IfVersion)
			case "update":
				v, err = t.UpdateDoc(it.Path, it.Data)
			case "rm":
				_, err = t.DeleteDoc(it.Path)
			}
			if err != nil {
				return err
			}
			versions[it.Path] = v
		}
		return nil
	})
	if err != nil {
		return nil, storeErr(err)
	}
	out := map[string]any{"count": len(items)}
	if c != nil {
		out["rev"] = c.Rev
	}
	if op != "rm" {
		out["versions"] = versions
	}
	return out, nil
}
