package verbs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// SQL, export and import.

func init() {
	storeArg := Arg{Name: "store", Type: "string", Pos: 1, Required: true}
	rowsArgs := []Arg{{Name: "rows", Type: "json", Doc: "a list of objects"}, {Name: "text", Type: "string", Doc: "CSV, JSONL or a JSON array"},
		{Name: "format", Type: "string", Doc: "csv, jsonl or json (with text)"}}
	Register(
		&Verb{Name: "sql.query", Doc: "Run a read-only SQL statement on a store (admins).", Scope: Admin, AdminOnly: true, Action: authz.StoreAdmin,
			Args: []Arg{storeArg, {Name: "sql", Type: "string", Pos: 2, Required: true}, {Name: "args", Type: "json", Doc: "positional parameters"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return runSQL(ctx, e, p, a, store.CallerAdminRead)
			}},
		&Verb{Name: "sql.exec", Doc: "Run SQL on a store's app tables (admins); --write allows writes.", Scope: Admin, AdminOnly: true, Action: authz.StoreAdmin,
			Args: []Arg{storeArg, {Name: "sql", Type: "string", Pos: 2, Required: true}, {Name: "args", Type: "json"},
				{Name: "write", Type: "bool", Doc: "allow INSERT, UPDATE and DELETE on app tables"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				caller := store.CallerAdminRead
				if a.B("write") {
					caller = store.CallerAdminWrite
				}
				return runSQL(ctx, e, p, a, caller)
			}},
		&Verb{Name: "sql.schema", Doc: "A store's app tables, indexes, views and triggers.", Scope: Read, Action: authz.StoreAdmin,
			Args: []Arg{storeArg},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "reading the schema")
				if err != nil {
					return nil, err
				}
				return s.AppSchema(ctx)
			}},
		&Verb{Name: "store.export", Doc: "A store's current documents, files (with their bytes), schema and table rows.", Scope: Read, Action: authz.StoreAdmin, StoreArg: "id",
			Args: []Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("id"), rt.LevelAdmin, "exporting")
				if err != nil {
					return nil, err
				}
				b, err := s.Export(ctx)
				if err != nil {
					return nil, err
				}
				bl := map[string]string{}
				for _, f := range b.Files {
					if _, ok := bl[f.SHA256]; ok {
						continue
					}
					data, err := s.Blobs.Read(f.SHA256)
					if err != nil {
						return nil, err
					}
					bl[f.SHA256] = base64.StdEncoding.EncodeToString(data)
				}
				return map[string]any{"id": s.ID, "bundle": b, "blobs": bl}, nil
			}},
		&Verb{Name: "import.folder", Doc: "Make a new store from an export bundle {bundle, blobs} (slop import folder reads the folder format).", Scope: Write, Action: authz.Program,
			Args: []Arg{{Name: "store", Type: "string", Pos: 1, Doc: "the new store's id"}, {Name: "bundle", Type: "json", Required: true},
				{Name: "blobs", Type: "json", Doc: "{sha256: base64}"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if !e.K.Access.AudienceOf(ctx, p).AtLeast(access.AudMember) {
					return nil, Errf("permission_denied", "only members make stores")
				}
				var b store.Bundle
				raw, _ := json.Marshal(a["bundle"])
				dec := json.NewDecoder(strings.NewReader(string(raw)))
				dec.UseNumber()
				if err := dec.Decode(&b); err != nil {
					return nil, Errf("invalid_argument", "bundle: %s", err.Error())
				}
				if err := putBlobs(e, a); err != nil {
					return nil, err
				}
				sums := []string{}
				for _, f := range b.Files {
					sums = append(sums, f.SHA256)
				}
				if missing := e.K.Blobs.Missing(sums); len(missing) > 0 {
					return nil, &Error{Code: "missing_blobs", Message: "send these blobs", Extra: map[string]any{"missing": missing}}
				}
				row, s, err := e.K.CreateStore(ctx, p, kernel.NewStore{ID: a.S("store"), Type: b.Meta["type"], App: b.Meta["app"]})
				if errors.Is(err, system.ErrExists) {
					return nil, Errf("conflict", "store %s exists", a.S("store"))
				}
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				c, err := s.Do(ctx, store.Who{ID: p.ID(), Via: p.ViaLabel(), Level: "owner", Code: authz.CodeRightOf(p)}, func(t *store.Turn) error {
					t.Summary = "imported"
					if err := t.Restore(&b); err != nil {
						return err
					}
					if len(b.Files) > 0 {
						_, err := t.Snapshot("import", "")
						return err
					}
					return nil
				})
				if err != nil {
					_ = e.K.DeleteStore(ctx, p, row.ID)
					if errors.Is(err, store.ErrAppCode) {
						return nil, Errf("permission_denied", "import refused, store removed: %s", err.Error())
					}
					return nil, Errf("invalid_argument", "import failed, store removed: %s", err.Error())
				}
				out := map[string]any{"store": row.ID, "docs": len(b.Docs), "files": len(b.Files), "tables": len(b.Tables)}
				if c != nil {
					out["rev"] = c.Rev
				}
				return out, nil
			}},
		&Verb{Name: "import.docs", Doc: "Import records as documents in coll, one commit per 500; --id names the field used as document id. CSV numbers and booleans are typed unless --raw.", Scope: Write, Action: authz.DocWrite,
			Args: append([]Arg{storeArg, {Name: "coll", Type: "string", Required: true}, {Name: "id", Type: "string", Doc: "field holding each document's id"},
				{Name: "raw", Type: "bool", Doc: "keep CSV values as strings"}}, rowsArgs...),
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				rows, err := records(a)
				if err != nil {
					return nil, err
				}
				if a.S("format") == "csv" && !a.B("raw") {
					for _, r := range rows {
						for k, v := range r {
							r[k] = inferCell(v)
						}
					}
				}
				if !rt.ValidCollPath(a.S("coll")) {
					return nil, Errf("invalid_argument", "invalid collection %q", a.S("coll"))
				}
				items := make([]docItem, 0, len(rows))
				for i, r := range rows {
					id := ids.Slug("d", 11)
					if f := a.S("id"); f != "" {
						v, ok := r[f]
						if !ok || fmt.Sprint(v) == "" {
							return nil, Errf("invalid_argument", "record %d has no %s", i+1, f)
						}
						id = fmt.Sprint(v)
					}
					items = append(items, docItem{Path: a.S("coll") + "/" + id, Data: r})
				}
				revs := []int64{}
				for start := 0; start < len(items); start += MaxBatch {
					end := min(start+MaxBatch, len(items))
					res, err := applyDocs(ctx, e, p, a.S("store"), items[start:end], "set")
					if err != nil {
						return map[string]any{"imported": start, "revs": revs}, err
					}
					if rev, ok := res.(map[string]any)["rev"].(int64); ok {
						revs = append(revs, rev)
					}
				}
				return map[string]any{"imported": len(items), "revs": revs}, nil
			}},
		&Verb{Name: "import.table", Doc: "Insert records into an app table (it must exist, from a migration), in one commit.", Scope: Write, Action: authz.StoreAdmin,
			Args: append([]Arg{storeArg, {Name: "table", Type: "string", Required: true}}, rowsArgs...),
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				s, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "importing rows")
				if err != nil {
					return nil, err
				}
				rows, err := records(a)
				if err != nil {
					return nil, err
				}
				c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
					return t.InsertRows(store.CallerAdminWrite, a.S("table"), rows)
				})
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				out := map[string]any{"imported": len(rows)}
				if c != nil {
					out["rev"] = c.Rev
				}
				return out, nil
			}},
	)
}

func runSQL(ctx context.Context, e *Env, p *access.Principal, a Args, caller string) (any, error) {
	s, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "running SQL")
	if err != nil {
		return nil, err
	}
	var params []any
	if l, ok := a.list("args"); ok {
		for _, v := range l {
			params = append(params, sqlArg(v))
		}
	}
	var rows []map[string]any
	var affected int64
	q := strings.TrimSpace(a.S("sql"))
	isQuery := returnsRows(q)
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		if isQuery {
			var err error
			rows, err = t.Query(caller, q, params...)
			return err
		}
		res, err := t.Exec(caller, q, params...)
		if err == nil {
			affected, _ = res.RowsAffected()
		}
		return err
	})
	if err != nil {
		return nil, Errf("invalid_argument", "%s", err.Error())
	}
	if isQuery {
		return rows, nil
	}
	out := map[string]any{"rowsAffected": affected}
	if c != nil {
		out["rev"] = c.Rev
	}
	return out, nil
}

func returnsRows(q string) bool {
	u := strings.ToUpper(q)
	return strings.HasPrefix(u, "SELECT") || strings.HasPrefix(u, "WITH") || strings.HasPrefix(u, "PRAGMA") ||
		strings.HasPrefix(u, "EXPLAIN") || strings.Contains(u, " RETURNING ")
}

func sqlArg(v any) any {
	if n, ok := v.(json.Number); ok {
		if i, err := n.Int64(); err == nil {
			return i
		}
		f, _ := n.Float64()
		return f
	}
	return v
}

// inferCell types a CSV cell when its text round-trips exactly: "42" and
// "1.5" become numbers, "true" and "false" booleans; "007" stays a string.
func inferCell(v any) any {
	str, ok := v.(string)
	if !ok {
		return v
	}
	switch str {
	case "true":
		return true
	case "false":
		return false
	}
	if n, err := strconv.ParseInt(str, 10, 64); err == nil && strconv.FormatInt(n, 10) == str {
		return n
	}
	if f, err := strconv.ParseFloat(str, 64); err == nil && strconv.FormatFloat(f, 'f', -1, 64) == str {
		return f
	}
	return str
}

// records reads rows, or text in a format, into objects.
func records(a Args) ([]map[string]any, error) {
	var list []any
	if l, ok := a.list("rows"); ok {
		list = l
	} else if a.Has("text") {
		text := a.S("text")
		switch a.S("format") {
		case "csv":
			return parseCSV([]byte(text))
		case "jsonl":
			for i, line := range strings.Split(text, "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				v := decodeJSON([]byte(line))
				if v == nil {
					return nil, Errf("invalid_argument", "line %d is not JSON", i+1)
				}
				list = append(list, v)
			}
		case "json", "":
			l, ok := decodeJSON([]byte(text)).([]any)
			if !ok {
				return nil, Errf("invalid_argument", "text is not a JSON array")
			}
			list = l
		default:
			return nil, Errf("invalid_argument", "format must be csv, jsonl or json")
		}
	} else {
		return nil, Errf("invalid_argument", "give rows, or text and format")
	}
	out := make([]map[string]any, 0, len(list))
	for i, v := range list {
		m, ok := v.(map[string]any)
		if !ok {
			return nil, Errf("invalid_argument", "record %d is not an object", i+1)
		}
		out = append(out, m)
	}
	return out, nil
}

// putBlobs stores the base64 blobs of a call after checking their hashes.
func putBlobs(e *Env, a Args) error {
	given, _ := a.obj("blobs")
	for sum, v := range given {
		str, _ := v.(string)
		data, err := base64.StdEncoding.DecodeString(str)
		if err != nil {
			return Errf("invalid_argument", "blob %s is not base64", sum)
		}
		if blobs.Sum(data) != sum {
			return Errf("invalid_argument", "blob %s does not match its sha256", sum)
		}
		if _, err := e.K.Blobs.Put(data); err != nil {
			return err
		}
	}
	return nil
}
