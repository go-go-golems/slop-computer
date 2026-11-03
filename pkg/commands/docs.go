package commands

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/invopop/jsonschema"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// MaxBatch is the most documents one docs.* call writes (in one turn).
const MaxBatch = 500

func docsVerbs(e kernelEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[DocsGetIn, any]{Name: "docs.get", Doc: "Read one document.", Scope: verbs.Read, Action: authz.DocRead,
			Run: func(req verbs.Req, in DocsGetIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelView, "reading")
				if err != nil {
					return nil, err
				}
				path, rules := in.Path, e.K.Rules(ctx, s.ID)
				doc, err := s.GetDoc(ctx, path, func(path string) bool { return rules.CanRead(path, p.ID(), d.Level) })
				if errors.Is(err, store.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no document %s", path)
				}
				return doc, err
			}}.Verb(),
		verbs.Def[DocsLsIn, any]{Name: "docs.ls", Doc: "List a collection's documents.", Scope: verbs.Read, Action: authz.DocRead,
			Run: func(req verbs.Req, in DocsLsIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				return queryDocs(ctx, e, p, in.Store, rt.Query{Coll: in.Coll, Limit: int(in.Limit)})
			}}.Verb(),
		verbs.Def[DocsQueryIn, []store.Doc]{Name: "docs.query", Doc: "Query a collection: where [[field, op, value], …], orderBy, desc, limit.",
			Scope: verbs.Read, Action: authz.DocRead,
			Run: func(r verbs.Req, in DocsQueryIn) ([]store.Doc, error) {
				q := rt.Query{Coll: in.Coll, Order: in.OrderBy, Desc: in.Desc, Limit: in.Limit}
				for _, c := range in.Where {
					q.Filters = append(q.Filters, rt.Filter(c))
				}
				return queryDocs(r, e, r.Principal, in.Store, q)
			}}.Verb(),
		verbs.Def[DocsSetIn, any]{Name: "docs.set", Doc: "Write whole documents: path and data, or batch [{path, data, ifVersion?}] in one commit.", Scope: verbs.Write, Action: authz.DocWrite,
			Run: func(req verbs.Req, in DocsSetIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				return writeDocs(ctx, e, p, in.Store, in.Path, in.Data, in.Batch, in.IfVersion, "set")
			}}.Verb(),
		verbs.Def[DocsUpdateIn, any]{Name: "docs.update", Doc: "Deep-merge data into documents (creating them): path and data, or batch [{path, data}].", Scope: verbs.Write, Action: authz.DocWrite,
			Run: func(req verbs.Req, in DocsUpdateIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				return writeDocs(ctx, e, p, in.Store, in.Path, in.Data, in.Batch, 0, "update")
			}}.Verb(),
		verbs.Def[DocsRmIn, any]{Name: "docs.rm", Doc: "Delete documents: path, or paths [..] in one commit.", Scope: verbs.Write, Action: authz.DocWrite,
			Run: func(req verbs.Req, in DocsRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				paths := []string(in.Paths)
				if in.Path != "" {
					paths = append(paths, in.Path)
				}
				items := make([]docItem, len(paths))
				for i, path := range paths {
					items[i] = docItem{Path: path}
				}
				return applyDocs(ctx, e, p, in.Store, items, "rm")
			}}.Verb(),
	}
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

func queryDocs(ctx context.Context, e kernelEnv, p *access.Principal, id string, q rt.Query) ([]store.Doc, error) {
	s, d, err := e.open(ctx, p, id, rt.LevelView, "reading")
	if err != nil {
		return nil, err
	}
	rules := e.K.Rules(ctx, s.ID)
	docs, err := s.Query(ctx, q, func(path string) bool { return rules.CanRead(path, p.ID(), d.Level) })
	if err != nil {
		return nil, storeErr(err)
	}
	return docs, nil
}

type docItem struct {
	Path      string
	Data      map[string]any
	IfVersion int64
}

func writeDocs(ctx context.Context, e kernelEnv, p *access.Principal, storeID, path string, data, batch any, ifVersion int64, op string) (any, error) {
	var items []docItem
	if batch != nil {
		l, ok := listOf(batch)
		if !ok {
			return nil, verbs.Errf("invalid_argument", "batch is a list of {path, data}")
		}
		for _, x := range l {
			m, ok := x.(map[string]any)
			if !ok {
				return nil, verbs.Errf("invalid_argument", "batch is a list of {path, data}")
			}
			it := docItem{Path: verbs.Args(m).S("path"), IfVersion: verbs.Args(m).I("ifVersion", 0)}
			if it.Data, ok = objOf(m["data"]); !ok {
				return nil, verbs.Errf("invalid_argument", "%s: data must be an object", it.Path)
			}
			items = append(items, it)
		}
	}
	if path != "" {
		obj, ok := objOf(data)
		if !ok {
			return nil, verbs.Errf("invalid_argument", "data must be a JSON object")
		}
		items = append(items, docItem{Path: path, Data: obj, IfVersion: ifVersion})
	}
	return applyDocs(ctx, e, p, storeID, items, op)
}

// applyDocs writes items in one turn after checking every path's rule.
func applyDocs(ctx context.Context, e kernelEnv, p *access.Principal, id string, items []docItem, op string) (any, error) {
	if len(items) == 0 {
		return nil, verbs.Errf("invalid_argument", "nothing to write: give path and data, or batch")
	}
	if len(items) > MaxBatch {
		return nil, verbs.Errf("invalid_argument", "at most %d documents per call", MaxBatch)
	}
	s, d, err := e.open(ctx, p, id, rt.LevelView, "writing")
	if err != nil {
		return nil, err
	}
	rules := e.K.Rules(ctx, s.ID)
	for _, it := range items {
		if !rules.CanWrite(it.Path, p.ID(), d.Level) {
			if !rules.CanRead(it.Path, p.ID(), d.Level) {
				return nil, verbs.Errf("not_found", "no document %s", it.Path)
			}
			_, need := rules.Need(it.Path, p.ID())
			return nil, &verbs.Error{Code: "permission_denied", Message: "writing " + it.Path + " needs " + need.String(),
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

// DocsQueryIn is docs.query's input.
type DocsQueryIn struct {
	Store   string `json:"store" slop:"pos=1" jsonschema_description:"the store"`
	Coll    string `json:"coll" slop:"pos=2" jsonschema_description:"the collection path"`
	Where   []Cond `json:"where,omitempty" jsonschema_description:"conditions, all of which must hold"`
	OrderBy string `json:"orderBy,omitempty" jsonschema_description:"the field to order by"`
	Desc    bool   `json:"desc,omitempty" jsonschema_description:"order descending"`
	Limit   int    `json:"limit,omitempty" jsonschema_description:"at most this many documents"`
}

// Cond is one where condition: [field, op, value] or {field, op, value}.
type Cond rt.Filter

// UnmarshalJSON accepts both forms.
func (c *Cond) UnmarshalJSON(b []byte) error {
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	f, ok := filterOf(v)
	if !ok {
		return errors.New("a where condition is [field, op, value] or {field, op, value}")
	}
	*c = Cond(f)
	return nil
}

// JSONSchema describes both forms.
func (Cond) JSONSchema() *jsonschema.Schema {
	three := uint64(3)
	ops := []any{"==", "!=", "<", "<=", ">", ">=", "array-contains", "in", "not-in"}
	obj := jsonschema.NewProperties()
	obj.Set("field", &jsonschema.Schema{Type: "string"})
	obj.Set("op", &jsonschema.Schema{Type: "string", Enum: ops})
	obj.Set("value", &jsonschema.Schema{})
	return &jsonschema.Schema{OneOf: []*jsonschema.Schema{
		{Type: "array", MinItems: &three, MaxItems: &three, PrefixItems: []*jsonschema.Schema{{Type: "string"}, {Type: "string", Enum: ops}, {}}},
		{Type: "object", Properties: obj, Required: []string{"field", "op", "value"}},
	}}
}

// DocsGetIn is docs.get's input.
type DocsGetIn struct {
	Store string `json:"store" slop:"pos=1"`
	Path  string `json:"path" slop:"pos=2"`
}

// DocsLsIn is docs.ls's input.
type DocsLsIn struct {
	Store string `json:"store" slop:"pos=1"`
	Coll  string `json:"coll" slop:"pos=2"`
	Limit int64  `json:"limit,omitempty"`
}

// DocsRmIn is docs.rm's input.
type DocsRmIn struct {
	Store string     `json:"store" slop:"pos=1"`
	Path  string     `json:"path,omitempty" slop:"pos=2"`
	Paths verbs.List `json:"paths,omitempty"`
}

// DocsSetIn is docs.set's input.
type DocsSetIn struct {
	Store     string `json:"store" slop:"pos=1"`
	Path      string `json:"path,omitempty" slop:"pos=2"`
	Data      any    `json:"data,omitempty"`
	IfVersion int64  `json:"ifVersion,omitempty" jsonschema_description:"fail unless the document is at this version"`
	Batch     any    `json:"batch,omitempty" jsonschema_description:"[{path, data, ifVersion?}]"`
}

// DocsUpdateIn is docs.update's input.
type DocsUpdateIn struct {
	Store string `json:"store" slop:"pos=1"`
	Path  string `json:"path,omitempty" slop:"pos=2"`
	Data  any    `json:"data,omitempty"`
	Batch any    `json:"batch,omitempty"`
}
