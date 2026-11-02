package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// Doc is one document as stored.
type Doc struct {
	Path    string         `json:"path"`
	Body    map[string]any `json:"body"`
	Version int64          `json:"version"`
	Rev     int64          `json:"rev"`
	By      string         `json:"by,omitempty"`
	At      int64          `json:"at"`
}

// DocError is a contract violation (bad path, body too large, too many documents).
type DocError struct{ Msg string }

func (e *DocError) Error() string { return e.Msg }

func decodeBody(raw sql.NullString) (map[string]any, error) {
	if !raw.Valid {
		return nil, nil
	}
	var m map[string]any
	dec := json.NewDecoder(stringsReader(raw.String))
	dec.UseNumber()
	if err := dec.Decode(&m); err != nil {
		return nil, err
	}
	return m, nil
}

// GetDoc reads a live document (ErrNotFound for missing or deleted).
func (s *Store) GetDoc(ctx context.Context, path string) (Doc, error) {
	return getDoc(ctx, s.ro, path)
}

// GetDoc reads a document inside the turn.
func (t *Turn) GetDoc(path string) (Doc, error) { return getDoc(t.ctx, t.s.w, path) }

type querier interface {
	QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row
	QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error)
}

func getDoc(ctx context.Context, q querier, path string) (Doc, error) {
	var d Doc
	var body, by sql.NullString
	err := q.QueryRowContext(ctx, `SELECT path, body, version, rev, by, at FROM _docs WHERE path = ?`, path).
		Scan(&d.Path, &body, &d.Version, &d.Rev, &by, &d.At)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !body.Valid) {
		return d, ErrNotFound
	}
	if err != nil {
		return d, err
	}
	d.By = by.String
	d.Body, err = decodeBody(body)
	return d, err
}

// SetDoc writes a whole document. ifVersion > 0 makes it conditional.
func (t *Turn) SetDoc(path string, body map[string]any, ifVersion int64) (int64, error) {
	return t.writeDoc(path, body, ifVersion, "set")
}

// UpdateDoc deep-merges patch into a document (creating it if missing).
func (t *Turn) UpdateDoc(path string, patch map[string]any) (int64, error) {
	cur, err := t.GetDoc(path)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return 0, err
	}
	merged := rt.Merge(cur.Body, patch)
	return t.writeDoc(path, merged, 0, "update")
}

// DeleteDoc deletes a document, leaving a tombstone.
func (t *Turn) DeleteDoc(path string) (bool, error) {
	if !rt.ValidDocPath(path) {
		return false, &DocError{"invalid document path " + fmt.Sprintf("%q", path)}
	}
	var version int64
	var body sql.NullString
	err := t.s.w.QueryRowContext(t.ctx, `SELECT version, body FROM _docs WHERE path = ?`, path).Scan(&version, &body)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !body.Valid) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	version++
	if _, err := t.s.w.ExecContext(t.ctx, `UPDATE _docs SET body = NULL, version = ?, rev = ?, size = 0, by = ?, at = ? WHERE path = ?`,
		version, t.Rev, nullStr(t.Who.ID), t.Now, path); err != nil {
		return false, err
	}
	t.record(Change{Kind: "doc", Key: path, Op: "delete", Version: version, Prev: []byte(body.String)})
	_ = t.addLive(-1)
	return true, nil
}

// RestoreDoc writes a document at a given version (imports).
func (t *Turn) RestoreDoc(path string, body map[string]any, version int64) error {
	if version < 1 {
		version = 1
	}
	_, err := t.writeDoc(path, body, version, "restore")
	return err
}

// addLive counts live documents within the turn, enforcing the quota
// without recounting the table on every write.
func (t *Turn) addLive(n int) error {
	if t.live < 0 && n < 0 {
		return nil // not counted yet; a later count sees the deletion
	}
	if t.live < 0 {
		if err := t.s.w.QueryRowContext(t.ctx, `SELECT count(*) FROM _docs WHERE body IS NOT NULL`).Scan(&t.live); err != nil {
			return err
		}
	}
	if n > 0 && t.live+n > rt.MaxDocsPerTarget {
		return &DocError{fmt.Sprintf("quota_exceeded: a store holds at most %d documents", rt.MaxDocsPerTarget)}
	}
	t.live += n
	return nil
}

func (t *Turn) writeDoc(path string, body map[string]any, ifVersion int64, op string) (int64, error) {
	if !rt.ValidDocPath(path) {
		return 0, &DocError{fmt.Sprintf("invalid document path %q", path)}
	}
	if body == nil {
		body = map[string]any{}
	}
	raw, err := rt.EncodeBody(body)
	if err != nil {
		return 0, &DocError{err.Error()}
	}
	var version int64
	var cur sql.NullString
	err = t.s.w.QueryRowContext(t.ctx, `SELECT version, body FROM _docs WHERE path = ?`, path).Scan(&version, &cur)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if op != "restore" && ifVersion > 0 && (!exists || !cur.Valid || version != ifVersion) {
		return 0, &DocError{fmt.Sprintf("conflict: %s is at version %d, not %d", path, version, ifVersion)}
	}
	if !exists || !cur.Valid {
		if err := t.addLive(1); err != nil {
			return 0, err
		}
	}
	version++
	if op == "restore" {
		version = ifVersion
	}
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _docs (path, coll, body, version, rev, size, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (path) DO UPDATE SET body = excluded.body, version = excluded.version, rev = excluded.rev,
		size = excluded.size, by = excluded.by, at = excluded.at`,
		path, rt.CollOf(path), string(raw), version, t.Rev, len(raw), nullStr(t.Who.ID), t.Now); err != nil {
		return 0, err
	}
	var prev []byte
	if cur.Valid {
		prev = []byte(cur.String)
	}
	t.record(Change{Kind: "doc", Key: path, Op: op, Version: version, Body: raw, Prev: prev})
	return version, nil
}

// Query runs a contract query over a collection's live documents.
func (s *Store) Query(ctx context.Context, q rt.Query) ([]Doc, error) {
	return queryDocs(ctx, s.ro, q)
}

// Query runs a contract query inside the turn.
func (t *Turn) QueryDocs(q rt.Query) ([]Doc, error) { return queryDocs(t.ctx, t.s.w, q) }

func queryDocs(ctx context.Context, db querier, q rt.Query) ([]Doc, error) {
	if err := q.Validate(); err != nil {
		return nil, &DocError{err.Error()}
	}
	rows, err := db.QueryContext(ctx, `SELECT path, body, version, rev, coalesce(by, ''), at FROM _docs WHERE coll = ? AND body IS NOT NULL`, q.Coll)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	all := map[string]Doc{}
	rtDocs := []rt.Doc{}
	for rows.Next() {
		var d Doc
		var body sql.NullString
		if err := rows.Scan(&d.Path, &body, &d.Version, &d.Rev, &d.By, &d.At); err != nil {
			return nil, err
		}
		if d.Body, err = decodeBody(body); err != nil {
			return nil, err
		}
		all[d.Path] = d
		rtDocs = append(rtDocs, rt.Doc{Path: d.Path, Body: d.Body, Version: d.Version})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := []Doc{}
	for _, rd := range q.Apply(rtDocs) {
		out = append(out, all[rd.Path])
	}
	return out, nil
}

// DocsSince returns documents changed after rev, tombstones included (Body nil).
func (s *Store) DocsSince(ctx context.Context, rev int64, prefix string) ([]Doc, error) {
	rows, err := s.ro.QueryContext(ctx, `SELECT path, body, version, rev, coalesce(by, ''), at FROM _docs WHERE rev > ? AND path LIKE ? ESCAPE '\' ORDER BY rev`,
		rev, likePrefix(prefix))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Doc{}
	for rows.Next() {
		var d Doc
		var body sql.NullString
		if err := rows.Scan(&d.Path, &body, &d.Version, &d.Rev, &d.By, &d.At); err != nil {
			return nil, err
		}
		d.Body, _ = decodeBody(body)
		out = append(out, d)
	}
	return out, rows.Err()
}

// CountDocs is the number of live documents.
func (s *Store) CountDocs(ctx context.Context) int {
	var n int
	_ = s.ro.QueryRowContext(ctx, `SELECT count(*) FROM _docs WHERE body IS NOT NULL`).Scan(&n)
	return n
}

// Collections lists collection paths with their live document counts.
func (s *Store) Collections(ctx context.Context) (map[string]int, error) {
	rows, err := s.ro.QueryContext(ctx, `SELECT coll, count(*) FROM _docs WHERE body IS NOT NULL GROUP BY coll ORDER BY coll`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var c string
		var n int
		if err := rows.Scan(&c, &n); err != nil {
			return nil, err
		}
		out[c] = n
	}
	return out, rows.Err()
}

func likePrefix(p string) string {
	r := ""
	for _, c := range p {
		if c == '%' || c == '_' || c == '\\' {
			r += "\\"
		}
		r += string(c)
	}
	return r + "%"
}
