package store

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Who acts in a turn.
type Who struct {
	ID    string // usr_…, vis_…, store:<id>, system
	Via   string // page, actor, reactor:<name>, cli, http, eval:<tok>, ...
	Level string // the actor's level on this store, for slop_level()
	App   string // app@version running, for the log
}

// Change is one changed thing in a commit.
type Change struct {
	Kind    string `json:"kind"` // doc file table ref snapshot schema meta
	Key     string `json:"key"`
	Op      string `json:"op"`
	Version int64  `json:"version,omitempty"`
}

// Commit is what one turn wrote.
type Commit struct {
	Store     string   `json:"store"`
	Epoch     int64    `json:"epoch"`
	Rev       int64    `json:"rev"`
	At        int64    `json:"at"`
	Principal string   `json:"principal"`
	Via       string   `json:"via"`
	App       string   `json:"app,omitempty"`
	Summary   string   `json:"summary,omitempty"`
	Changes   []Change `json:"changes"`
}

// Turn is one transaction on the store's writer.
type Turn struct {
	s       *Store
	ctx     context.Context
	Who     Who
	Now     int64
	Rev     int64 // the rev this turn's commit gets, if it changes anything
	Summary string
	caller  string
	changes []Change
	tables  map[string]bool
	schema  bool
	live    int // live documents, counted on first need (-1: not yet)
}

// Do runs fn as one turn. On success it commits; a turn that changed
// anything gets the next rev and a log entry, and OnCommit is called with
// the commit afterwards. On error everything rolls back.
func (s *Store) Do(ctx context.Context, who Who, fn func(t *Turn) error) (*Commit, error) {
	s.mu.Lock()
	c, err := s.doLocked(ctx, who, fn)
	s.mu.Unlock()
	if err == nil && c != nil && s.OnCommit != nil {
		s.OnCommit(c)
	}
	return c, err
}

func (s *Store) doLocked(ctx context.Context, who Who, fn func(t *Turn) error) (c *Commit, err error) {
	if _, err := s.w.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return nil, err
	}
	t := &Turn{s: s, ctx: ctx, Who: who, Now: time.Now().UnixMilli(), caller: CallerKernel, tables: map[string]bool{}, live: -1}
	if err := s.w.QueryRowContext(ctx, `SELECT coalesce(max(rev), 0) + 1 FROM _log`).Scan(&t.Rev); err != nil {
		_, _ = s.w.ExecContext(context.Background(), `ROLLBACK`)
		return nil, err
	}
	s.cur = t
	defer func() {
		s.cur = nil
		if r := recover(); r != nil {
			_, _ = s.w.ExecContext(context.Background(), `ROLLBACK`)
			err = fmt.Errorf("turn panicked: %v", r)
		}
	}()
	if err := fn(t); err != nil {
		_, _ = s.w.ExecContext(context.Background(), `ROLLBACK`)
		return nil, err
	}
	t.caller = CallerKernel
	changes := t.allChanges()
	if len(changes) > 0 {
		if err := t.writeLog(changes); err != nil {
			_, _ = s.w.ExecContext(context.Background(), `ROLLBACK`)
			return nil, err
		}
	}
	if _, err := s.w.ExecContext(ctx, `COMMIT`); err != nil {
		_, _ = s.w.ExecContext(context.Background(), `ROLLBACK`)
		return nil, err
	}
	if len(changes) == 0 {
		return nil, nil
	}
	return &Commit{Store: s.ID, Epoch: s.Epoch(), Rev: t.Rev, At: t.Now, Principal: who.ID, Via: who.Via, App: who.App,
		Summary: t.Summary, Changes: changes}, nil
}

func (t *Turn) allChanges() []Change {
	out := append([]Change{}, t.changes...)
	names := make([]string, 0, len(t.tables))
	for n := range t.tables {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		out = append(out, Change{Kind: "table", Key: n, Op: "write"})
	}
	if t.schema {
		out = append(out, Change{Kind: "schema", Key: "", Op: "migrate"})
	}
	return out
}

func (t *Turn) writeLog(changes []Change) error {
	summary := t.Summary
	if summary == "" {
		summary = summarize(changes)
	}
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _log (rev, at, principal, via, app, summary) VALUES (?, ?, ?, ?, ?, ?)`,
		t.Rev, t.Now, t.Who.ID, t.Who.Via, nullStr(t.Who.App), summary); err != nil {
		return err
	}
	for i, c := range changes {
		var v any
		if c.Version != 0 {
			v = c.Version
		}
		if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _changes (rev, seq, kind, key, op, version) VALUES (?, ?, ?, ?, ?, ?)`,
			t.Rev, i, c.Kind, c.Key, c.Op, v); err != nil {
			return err
		}
	}
	t.Summary = summary
	return nil
}

func summarize(cs []Change) string {
	if len(cs) == 1 {
		return cs[0].Op + " " + cs[0].Kind + " " + cs[0].Key
	}
	kinds := map[string]int{}
	for _, c := range cs {
		kinds[c.Kind]++
	}
	parts := []string{}
	for _, k := range []string{"doc", "file", "table", "snapshot", "ref", "schema", "meta"} {
		if n := kinds[k]; n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", n, k))
		}
	}
	return strings.Join(parts, ", ")
}

// record adds a change to the turn.
func (t *Turn) record(c Change) { t.changes = append(t.changes, c) }

// Context is the turn's context.
func (t *Turn) Context() context.Context { return t.ctx }

// WithCaller runs fn with statements authorized as caller.
func (t *Turn) WithCaller(caller string, fn func() error) error {
	prev := t.caller
	t.caller = caller
	defer func() { t.caller = prev }()
	return fn()
}

// Exec runs app SQL as the given caller (actor, migration, admin-write).
func (t *Turn) Exec(caller, q string, args ...any) (sql.Result, error) {
	var res sql.Result
	err := t.WithCaller(caller, func() error {
		var err error
		res, err = t.s.w.ExecContext(t.ctx, q, args...)
		return err
	})
	return res, err
}

// Query runs app SQL as caller and returns rows as maps.
func (t *Turn) Query(caller, q string, args ...any) ([]map[string]any, error) {
	var out []map[string]any
	err := t.WithCaller(caller, func() error {
		rows, err := t.s.w.QueryContext(t.ctx, q, args...)
		if err != nil {
			return err
		}
		out, err = scanMaps(rows, 10000)
		return err
	})
	return out, err
}

// SetMeta writes a _meta value as part of the turn.
func (t *Turn) SetMeta(key, value string) error {
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, key, value); err != nil {
		return err
	}
	t.record(Change{Kind: "meta", Key: key, Op: "set"})
	return nil
}

// Meta reads a _meta value inside the turn.
func (t *Turn) Meta(key string) string {
	var v string
	_ = t.s.w.QueryRowContext(t.ctx, `SELECT value FROM _meta WHERE key = ?`, key).Scan(&v)
	return v
}

// scanMaps reads rows into maps, converting []byte to string.
func scanMaps(rows *sql.Rows, max int) ([]map[string]any, error) {
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		if len(out) >= max {
			return nil, fmt.Errorf("more than %d rows", max)
		}
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		m := make(map[string]any, len(cols))
		for i, c := range cols {
			if b, ok := vals[i].([]byte); ok {
				m[c] = string(b)
			} else {
				m[c] = vals[i]
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ReadQuery runs a read-only statement on a reader connection (no slop_*
// functions there). Used by verbs that list kernel tables.
func (s *Store) ReadQuery(ctx context.Context, q string, args ...any) ([]map[string]any, error) {
	rows, err := s.ro.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	return scanMaps(rows, 10000)
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}
