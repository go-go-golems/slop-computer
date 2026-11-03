package store

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Bundle is a store's current state in a portable shape: the folder export
// format, in memory. History (the log, snapshots) is not part of it.
type Bundle struct {
	Meta   map[string]string           `json:"meta"`
	Docs   []BundleDoc                 `json:"docs"`
	Files  []File                      `json:"files"`
	Schema []SchemaObject              `json:"schema"`
	Tables map[string][]map[string]any `json:"tables"`
}

// BundleDoc is one exported document.
type BundleDoc struct {
	Path    string         `json:"path"`
	Body    map[string]any `json:"body"`
	Version int64          `json:"version,omitempty"`
}

// SchemaObject is one app table, index, view or trigger.
type SchemaObject struct {
	Type  string `json:"type"` // table, virtual, index, view, trigger
	Name  string `json:"name"`
	Table string `json:"table,omitempty"`
	SQL   string `json:"sql"`
}

// metaKept are the _meta keys an import restores.
var metaKept = map[string]bool{"type": true, "app": true, "app_ref": true}

// AppSchema lists the app's schema objects in creation order. Kernel tables
// and the shadow tables of virtual tables are left out.
func (s *Store) AppSchema(ctx context.Context) ([]SchemaObject, error) {
	kinds := map[string]string{}
	tl, err := s.ReadQuery(ctx, `SELECT name, type FROM pragma_table_list WHERE schema = 'main'`)
	if err != nil {
		return nil, err
	}
	for _, r := range tl {
		kinds[fmt.Sprint(r["name"])] = fmt.Sprint(r["type"])
	}
	rows, err := s.ReadQuery(ctx, `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid`)
	if err != nil {
		return nil, err
	}
	out := []SchemaObject{}
	for _, r := range rows {
		o := SchemaObject{Type: fmt.Sprint(r["type"]), Name: fmt.Sprint(r["name"]), Table: fmt.Sprint(r["tbl_name"]), SQL: fmt.Sprint(r["sql"])}
		if !appName(o.Name) || !appName(o.Table) {
			continue
		}
		if o.Type == "table" {
			switch kinds[o.Name] {
			case "shadow":
				continue
			case "virtual":
				o.Type = "virtual"
			}
		}
		out = append(out, o)
	}
	return out, nil
}

// ownContent reports a virtual table that stores its own rows (an FTS5
// table without content=), whose rows must be exported.
func ownContent(o SchemaObject) bool {
	return o.Type == "virtual" && !strings.Contains(strings.ToLower(o.SQL), "content=")
}

// Export reads the store's current state.
func (s *Store) Export(ctx context.Context) (*Bundle, error) {
	b := &Bundle{Meta: map[string]string{}, Tables: map[string][]map[string]any{}}
	for k, v := range s.AllMeta() {
		if metaKept[k] {
			b.Meta[k] = v
		}
	}
	rows, err := s.ro.QueryContext(ctx, `SELECT path, body, version FROM _docs WHERE body IS NOT NULL ORDER BY path`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d BundleDoc
		var raw string
		if err := rows.Scan(&d.Path, &raw, &d.Version); err != nil {
			_ = rows.Close()
			return nil, err
		}
		dec := json.NewDecoder(strings.NewReader(raw))
		dec.UseNumber()
		if err := dec.Decode(&d.Body); err != nil {
			_ = rows.Close()
			return nil, err
		}
		b.Docs = append(b.Docs, d)
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return nil, err
	}
	for _, zone := range []string{"tree", "assets"} {
		fs, err := s.Files(ctx, zone, "")
		if err != nil {
			return nil, err
		}
		for i := range fs {
			fs[i].Rev = 0
		}
		b.Files = append(b.Files, fs...)
	}
	if b.Schema, err = s.AppSchema(ctx); err != nil {
		return nil, err
	}
	for _, o := range b.Schema {
		if o.Type != "table" && !ownContent(o) {
			continue
		}
		rs, err := s.tableRows(ctx, o.Name)
		if err != nil {
			return nil, err
		}
		b.Tables[o.Name] = rs
	}
	return b, nil
}

// Restore writes a bundle into the store in this turn: tables and their
// rows first, then indexes, views and triggers (so triggers do not fire on
// the restored rows), then documents and files. Blobs must already exist.
func (t *Turn) Restore(b *Bundle) error {
	for k, v := range b.Meta {
		if metaKept[k] {
			if err := t.SetMeta(k, v); err != nil {
				return err
			}
		}
	}
	for _, o := range b.Schema {
		if o.Type != "table" && o.Type != "virtual" {
			continue
		}
		if _, err := t.Exec(CallerMigration, o.SQL); err != nil {
			return fmt.Errorf("creating %s: %w", o.Name, err)
		}
		if o.Type == "table" || ownContent(o) {
			if err := t.insertRows(o.Name, b.Tables[o.Name]); err != nil {
				return err
			}
		}
	}
	for _, o := range b.Schema {
		if o.Type == "table" || o.Type == "virtual" {
			continue
		}
		if _, err := t.Exec(CallerMigration, o.SQL); err != nil {
			return fmt.Errorf("creating %s: %w", o.Name, err)
		}
	}
	for _, o := range b.Schema {
		if o.Type == "virtual" && !ownContent(o) && strings.Contains(strings.ToLower(o.SQL), "fts5") {
			// External-content FTS: rebuild the index from its content table.
			_, _ = t.Exec(CallerMigration, `INSERT INTO `+quoteIdent(o.Name)+`(`+quoteIdent(o.Name)+`) VALUES ('rebuild')`)
		}
	}
	for _, d := range b.Docs {
		if err := t.RestoreDoc(d.Path, d.Body, d.Version); err != nil {
			return err
		}
	}
	for _, f := range b.Files {
		if _, err := t.PutBlob(f.Zone, f.Path, f.SHA256, f.Size, f.Type); err != nil {
			return err
		}
	}
	return nil
}

// InsertRows inserts JSON rows into an app table as the given caller.
func (t *Turn) InsertRows(caller, table string, rows []map[string]any) error {
	return t.WithCaller(caller, func() error { return t.insertRowsRaw(table, rows) })
}

func (t *Turn) insertRows(table string, rows []map[string]any) error {
	return t.InsertRows(CallerMigration, table, rows)
}

func (t *Turn) insertRowsRaw(table string, rows []map[string]any) error {
	for _, r := range rows {
		cols := make([]string, 0, len(r))
		for c := range r {
			cols = append(cols, c)
		}
		// Stable column order keeps statements cacheable and errors readable.
		sort.Strings(cols)
		qs := make([]string, len(cols))
		args := make([]any, len(cols))
		for i, c := range cols {
			qs[i] = "?"
			args[i] = sqlValue(r[c])
			cols[i] = quoteIdent(c)
		}
		q := `INSERT INTO ` + quoteIdent(table) + ` (` + strings.Join(cols, ", ") + `) VALUES (` + strings.Join(qs, ", ") + `)`
		if _, err := t.s.w.ExecContext(t.ctx, q, args...); err != nil {
			return fmt.Errorf("inserting into %s: %w", table, err)
		}
	}
	return nil
}

// blobKey marks a BLOB in exported rows: {"$blob": base64}. JSON has no
// bytes, and a string would lose both the type and any bytes that are not
// UTF-8.
const blobKey = "$blob"

// tableRows reads an app table for export, BLOBs as {"$blob": base64}.
func (s *Store) tableRows(ctx context.Context, table string) ([]map[string]any, error) {
	rows, err := s.ro.QueryContext(ctx, `SELECT * FROM `+quoteIdent(table))
	if err != nil {
		return nil, err
	}
	return scanRows(rows, 10000, func(b []byte) any {
		return map[string]any{blobKey: base64.StdEncoding.EncodeToString(b)}
	})
}

// sqlValue converts a decoded JSON value to a SQLite argument.
func sqlValue(v any) any {
	if m, ok := v.(map[string]any); ok && len(m) == 1 {
		if s, ok := m[blobKey].(string); ok {
			if b, err := base64.StdEncoding.DecodeString(s); err == nil {
				return b
			}
		}
	}
	switch x := v.(type) {
	case json.Number:
		if n, err := strconv.ParseInt(string(x), 10, 64); err == nil {
			return n
		}
		f, _ := x.Float64()
		return f
	case bool:
		if x {
			return 1
		}
		return 0
	case map[string]any, []any:
		b, _ := json.Marshal(x)
		return string(b)
	}
	return v
}

func quoteIdent(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }
