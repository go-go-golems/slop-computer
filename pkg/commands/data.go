package commands

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
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// SQL, export and import.

func dataVerbs(e kernelEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[SqlQueryIn, any]{Name: "sql.query", Doc: "Run a read-only SQL statement on a store (admins).", Scope: verbs.Read, AdminOnly: true, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in SqlQueryIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				return runSQL(ctx, e, p, in.Store, in.Sql, in.Args, store.CallerAdminRead)
			}}.Verb(),
		verbs.Def[SqlExecIn, any]{Name: "sql.exec", Doc: "Run SQL on a store's app tables (admins); --write allows writes.", Scope: verbs.Write, AdminOnly: true, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in SqlExecIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				caller := store.CallerAdminRead
				if in.Write {
					caller = store.CallerAdminWrite
				}
				return runSQL(ctx, e, p, in.Store, in.Sql, in.Args, caller)
			}}.Verb(),
		verbs.Def[SqlSchemaIn, []store.SchemaObject]{Name: "sql.schema", Doc: "A store's app tables, indexes, views and triggers.", Scope: verbs.Read, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in SqlSchemaIn) ([]store.SchemaObject, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "reading the schema")
				if err != nil {
					return nil, err
				}
				return s.AppSchema(ctx)
			}}.Verb(),
		verbs.Def[StoreExportIn, StoreExportOut]{Name: "store.export", Doc: "A store's current documents, files (with their bytes), schema and table rows.", Scope: verbs.Read, Action: authz.StoreAdmin, StoreArg: "id",
			Run: func(req verbs.Req, in StoreExportIn) (StoreExportOut, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.ID, rt.LevelAdmin, "exporting")
				if err != nil {
					return StoreExportOut{}, err
				}
				b, err := s.Export(ctx)
				if err != nil {
					return StoreExportOut{}, err
				}
				bl := map[string]string{}
				for _, f := range b.Files {
					if _, ok := bl[f.SHA256]; ok {
						continue
					}
					data, err := s.Blobs.Read(f.SHA256)
					if err != nil {
						return StoreExportOut{}, err
					}
					bl[f.SHA256] = base64.StdEncoding.EncodeToString(data)
				}
				return StoreExportOut{ID: s.ID, Bundle: b, Blobs: bl}, nil
			}}.Verb(),
		verbs.Def[ImportFolderIn, ImportFolderOut]{Name: "import.folder", Doc: "Make a new store from an export bundle {bundle, blobs} (slop import folder reads the folder format).", Scope: verbs.Write, Action: authz.Program,
			Run: func(req verbs.Req, in ImportFolderIn) (ImportFolderOut, error) {
				ctx := req.Context
				p := req.Principal
				if !e.K.Access.In(ctx, p, access.GroupMember) {
					return ImportFolderOut{}, verbs.Errf("permission_denied", "only members make stores")
				}
				var b store.Bundle
				raw, _ := json.Marshal(in.Bundle)
				dec := json.NewDecoder(strings.NewReader(string(raw)))
				dec.UseNumber()
				if err := dec.Decode(&b); err != nil {
					return ImportFolderOut{}, verbs.Errf("invalid_argument", "bundle: %s", err.Error())
				}
				if err := putBlobs(e, in.Blobs); err != nil {
					return ImportFolderOut{}, err
				}
				sums := []string{}
				for _, f := range b.Files {
					sums = append(sums, f.SHA256)
				}
				if missing := e.K.Blobs.Missing(sums); len(missing) > 0 {
					return ImportFolderOut{}, &verbs.Error{Code: "missing_blobs", Message: "send these blobs", Extra: map[string]any{"missing": missing}}
				}
				row, s, err := e.K.CreateStore(ctx, p, kernel.NewStore{ID: in.Store, Type: b.Meta["type"], App: b.Meta["app"]})
				if errors.Is(err, registry.ErrExists) {
					return ImportFolderOut{}, verbs.Errf("conflict", "store %s exists", in.Store)
				}
				if err != nil {
					return ImportFolderOut{}, verbs.Errf("invalid_argument", "%s", err.Error())
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
						return ImportFolderOut{}, verbs.Errf("permission_denied", "import refused, store removed: %s", err.Error())
					}
					return ImportFolderOut{}, verbs.Errf("invalid_argument", "import failed, store removed: %s", err.Error())
				}
				out := ImportFolderOut{Store: row.ID, Docs: len(b.Docs), Files: len(b.Files), Tables: len(b.Tables)}
				if c != nil {
					out.Rev = ptr[int64](c.Rev)
				}
				return out, nil
			}}.Verb(),
		verbs.Def[ImportDocsIn, ImportDocsOut]{Name: "import.docs", Doc: "Import records as documents in coll, one commit per 500; --id names the field used as document id. CSV numbers and booleans are typed unless --raw.", Scope: verbs.Write, Action: authz.DocWrite,
			Run: func(req verbs.Req, in ImportDocsIn) (ImportDocsOut, error) {
				ctx := req.Context
				p := req.Principal
				rows, err := records(in.Rows, or(in.Text, ""), in.Text != nil, in.Format)
				if err != nil {
					return ImportDocsOut{}, err
				}
				if in.Format == "csv" && !in.Raw {
					for _, r := range rows {
						for k, v := range r {
							r[k] = inferCell(v)
						}
					}
				}
				if !rt.ValidCollPath(in.Coll) {
					return ImportDocsOut{}, verbs.Errf("invalid_argument", "invalid collection %q", in.Coll)
				}
				items := make([]docItem, 0, len(rows))
				for i, r := range rows {
					id := ids.Slug("d", 11)
					if f := in.ID; f != "" {
						v, ok := r[f]
						if !ok || fmt.Sprint(v) == "" {
							return ImportDocsOut{}, verbs.Errf("invalid_argument", "record %d has no %s", i+1, f)
						}
						id = fmt.Sprint(v)
					}
					items = append(items, docItem{Path: in.Coll + "/" + id, Data: r})
				}
				revs := []int64{}
				for start := 0; start < len(items); start += MaxBatch {
					end := min(start+MaxBatch, len(items))
					res, err := applyDocs(ctx, e, p, in.Store, items[start:end], "set")
					if err != nil {
						return ImportDocsOut{Imported: start, Revs: revs}, err
					}
					if rev, ok := res.(map[string]any)["rev"].(int64); ok {
						revs = append(revs, rev)
					}
				}
				return ImportDocsOut{Imported: len(items), Revs: revs}, nil
			}}.Verb(),
		verbs.Def[ImportTableIn, ImportTableOut]{Name: "import.table", Doc: "Insert records into an app table (it must exist, from a migration), in one commit.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in ImportTableIn) (ImportTableOut, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "importing rows")
				if err != nil {
					return ImportTableOut{}, err
				}
				rows, err := records(in.Rows, or(in.Text, ""), in.Text != nil, in.Format)
				if err != nil {
					return ImportTableOut{}, err
				}
				c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
					return t.InsertRows(store.CallerAdminWrite, in.Table, rows)
				})
				if err != nil {
					return ImportTableOut{}, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				out := ImportTableOut{Imported: len(rows)}
				if c != nil {
					out.Rev = ptr[int64](c.Rev)
				}
				return out, nil
			}}.Verb(),
	}
}

func runSQL(ctx context.Context, e kernelEnv, p *access.Principal, storeID, sql string, args any, caller string) (any, error) {
	s, d, err := e.open(ctx, p, storeID, rt.LevelAdmin, "running SQL")
	if err != nil {
		return nil, err
	}
	var params []any
	if l, ok := listOf(args); ok {
		for _, v := range l {
			params = append(params, sqlArg(v))
		}
	}
	var rows []map[string]any
	var affected int64
	q := strings.TrimSpace(sql)
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
		return nil, verbs.Errf("invalid_argument", "%s", err.Error())
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
func records(rowsArg any, text string, hasText bool, format string) ([]map[string]any, error) {
	var list []any
	if l, ok := listOf(rowsArg); ok {
		list = l
	} else if hasText {
		switch format {
		case "csv":
			return parseCSV([]byte(text))
		case "jsonl":
			for i, line := range strings.Split(text, "\n") {
				if strings.TrimSpace(line) == "" {
					continue
				}
				v := decodeJSON([]byte(line))
				if v == nil {
					return nil, verbs.Errf("invalid_argument", "line %d is not JSON", i+1)
				}
				list = append(list, v)
			}
		case "json", "":
			l, ok := decodeJSON([]byte(text)).([]any)
			if !ok {
				return nil, verbs.Errf("invalid_argument", "text is not a JSON array")
			}
			list = l
		default:
			return nil, verbs.Errf("invalid_argument", "format must be csv, jsonl or json")
		}
	} else {
		return nil, verbs.Errf("invalid_argument", "give rows, or text and format")
	}
	out := make([]map[string]any, 0, len(list))
	for i, v := range list {
		m, ok := v.(map[string]any)
		if !ok {
			return nil, verbs.Errf("invalid_argument", "record %d is not an object", i+1)
		}
		out = append(out, m)
	}
	return out, nil
}

// putBlobs stores the base64 blobs of a call after checking their hashes.
func putBlobs(e kernelEnv, blobsArg any) error {
	given, _ := objOf(blobsArg)
	for sum, v := range given {
		str, _ := v.(string)
		data, err := base64.StdEncoding.DecodeString(str)
		if err != nil {
			return verbs.Errf("invalid_argument", "blob %s is not base64", sum)
		}
		if blobs.Sum(data) != sum {
			return verbs.Errf("invalid_argument", "blob %s does not match its sha256", sum)
		}
		if _, err := e.K.Blobs.Put(data); err != nil {
			return err
		}
	}
	return nil
}

// SqlSchemaIn is sql.schema's input.
type SqlSchemaIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// StoreExportIn is store.export's input.
type StoreExportIn struct {
	ID string `json:"id" slop:"pos=1"`
}

// SqlQueryIn is sql.query's input.
type SqlQueryIn struct {
	Store string `json:"store" slop:"pos=1"`
	Sql   string `json:"sql" slop:"pos=2"`
	Args  any    `json:"args,omitempty" jsonschema_description:"positional parameters"`
}

// SqlExecIn is sql.exec's input.
type SqlExecIn struct {
	Store string `json:"store" slop:"pos=1"`
	Sql   string `json:"sql" slop:"pos=2"`
	Args  any    `json:"args,omitempty"`
	Write bool   `json:"write,omitempty" jsonschema_description:"allow INSERT, UPDATE and DELETE on app tables"`
}

// ImportFolderIn is import.folder's input.
type ImportFolderIn struct {
	Store  string `json:"store,omitempty" slop:"pos=1" jsonschema_description:"the new store's id"`
	Bundle any    `json:"bundle"`
	Blobs  any    `json:"blobs,omitempty" jsonschema_description:"{sha256: base64}"`
}

// ImportDocsIn is import.docs's input.
type ImportDocsIn struct {
	Store  string  `json:"store" slop:"pos=1"`
	Coll   string  `json:"coll"`
	ID     string  `json:"id,omitempty" jsonschema_description:"field holding each document's id"`
	Raw    bool    `json:"raw,omitempty" jsonschema_description:"keep CSV values as strings"`
	Rows   any     `json:"rows,omitempty" jsonschema_description:"a list of objects"`
	Text   *string `json:"text,omitempty" jsonschema_description:"CSV, JSONL or a JSON array"`
	Format string  `json:"format,omitempty" jsonschema_description:"csv, jsonl or json (with text)"`
}

// ImportTableIn is import.table's input.
type ImportTableIn struct {
	Store  string  `json:"store" slop:"pos=1"`
	Table  string  `json:"table"`
	Rows   any     `json:"rows,omitempty" jsonschema_description:"a list of objects"`
	Text   *string `json:"text,omitempty" jsonschema_description:"CSV, JSONL or a JSON array"`
	Format string  `json:"format,omitempty" jsonschema_description:"csv, jsonl or json (with text)"`
}

// StoreExportOut is store.export's result.
type StoreExportOut struct {
	Blobs  map[string]string `json:"blobs"`
	Bundle *store.Bundle     `json:"bundle"`
	ID     string            `json:"id"`
}

// ImportFolderOut is import.folder's result.
type ImportFolderOut struct {
	Docs   int    `json:"docs"`
	Files  int    `json:"files"`
	Rev    *int64 `json:"rev,omitempty"`
	Store  string `json:"store"`
	Tables int    `json:"tables"`
}

// ImportDocsOut is import.docs's result.
type ImportDocsOut struct {
	Imported int     `json:"imported"`
	Revs     []int64 `json:"revs"`
}

// ImportTableOut is import.table's result.
type ImportTableOut struct {
	Imported int    `json:"imported"`
	Rev      *int64 `json:"rev,omitempty"`
}
