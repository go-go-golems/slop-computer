package registry

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Mount maps a host and path pattern to a store.
type Mount struct {
	Host           string `json:"host"`
	Path           string `json:"path"`                     // /guestbook, /r/:store, /docs/*
	Store          string `json:"store,omitempty"`          // a fixed store
	StoreParam     string `json:"storeParam,omitempty"`     // or the path parameter naming it
	Type           string `json:"type,omitempty"`           // with StoreParam: the type required
	CreateApp      string `json:"createApp,omitempty"`      // live hosts: offer to create a store of this app
	CreateAudience string `json:"createAudience,omitempty"` // who may create: member, subscriber or admin
	// Aliases bind each store the mount creates (with CreateApp): bindings
	// without their store, which is the new one (SLOP3-008 phase 4).
	Aliases   []Binding `json:"aliases,omitempty"`
	ChangedBy string    `json:"changedBy,omitempty"`
	ChangedAt int64     `json:"changedAt"`
}

const mountCols = `host, path, coalesce(store, ''), coalesce(store_param, ''), coalesce(type, ''), coalesce(create_app, ''),
	coalesce(create_audience, ''), aliases, coalesce(changed_by, ''), changed_at`

func scanMount(row interface{ Scan(...any) error }) (Mount, error) {
	var m Mount
	var aliases string
	err := row.Scan(&m.Host, &m.Path, &m.Store, &m.StoreParam, &m.Type, &m.CreateApp, &m.CreateAudience, &aliases, &m.ChangedBy, &m.ChangedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return m, sysdb.ErrNotFound
	}
	if err == nil && aliases != "" {
		err = json.Unmarshal([]byte(aliases), &m.Aliases)
	}
	return m, err
}

// Mounts lists the mounts of a host (all hosts when host is "").
func (d *Registry) Mounts(ctx context.Context, host string) ([]Mount, error) {
	q, args := `SELECT `+mountCols+` FROM mounts ORDER BY host, path`, []any{}
	if host != "" {
		q, args = `SELECT `+mountCols+` FROM mounts WHERE host = ? ORDER BY path`, []any{host}
	}
	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Mount{}
	for rows.Next() {
		m, err := scanMount(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ValidMountPath checks a mount pattern: absolute, clean segments of
// literals and :params, an optional trailing *.
func ValidMountPath(p string) bool {
	if p == "/" {
		return true
	}
	if !strings.HasPrefix(p, "/") || strings.HasSuffix(p, "/") || strings.Contains(p, "//") {
		return false
	}
	segs := strings.Split(p[1:], "/")
	for i, s := range segs {
		switch {
		case s == "*":
			if i != len(segs)-1 {
				return false
			}
		case strings.HasPrefix(s, ":"):
			if len(s) < 2 {
				return false
			}
		case s == "." || s == ".." || strings.ContainsAny(s, "?#%*:"):
			return false
		}
	}
	return true
}

// aliasesJSON is a mount's alias template as stored: "" for none.
func aliasesJSON(bs []Binding) string {
	if len(bs) == 0 {
		return ""
	}
	b, _ := json.Marshal(bs)
	return string(b)
}

func mountJSON(m *Mount) string {
	if m == nil {
		return ""
	}
	b, _ := json.Marshal(m)
	return string(b)
}

// SetMount creates or replaces a mount, recording the previous value.
func (d *Registry) SetMount(ctx context.Context, actor, via string, m Mount) (Mount, error) {
	m.ChangedBy, m.ChangedAt = actor, d.NowMs()
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var before *Mount
		if old, err := scanMount(tx.QueryRowContext(ctx, `SELECT `+mountCols+` FROM mounts WHERE host = ? AND path = ?`, m.Host, m.Path)); err == nil {
			before = &old
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO mounts (host, path, store, store_param, type, create_app, create_audience, aliases, changed_by, changed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (host, path) DO UPDATE SET store = excluded.store, store_param = excluded.store_param,
			type = excluded.type, create_app = excluded.create_app, create_audience = excluded.create_audience, aliases = excluded.aliases,
			changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
			m.Host, m.Path, sysdb.NullStr(m.Store), sysdb.NullStr(m.StoreParam), sysdb.NullStr(m.Type), sysdb.NullStr(m.CreateApp), sysdb.NullStr(m.CreateAudience), aliasesJSON(m.Aliases), sysdb.NullStr(actor), m.ChangedAt); err != nil {
			return err
		}
		return d.logMount(ctx, tx, actor, via, m.Host, m.Path, before, &m)
	})
	return m, err
}

// RemoveMount deletes a mount, recording it so it can be undone.
func (d *Registry) RemoveMount(ctx context.Context, actor, via, host, path string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		old, err := scanMount(tx.QueryRowContext(ctx, `SELECT `+mountCols+` FROM mounts WHERE host = ? AND path = ?`, host, path))
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM mounts WHERE host = ? AND path = ?`, host, path); err != nil {
			return err
		}
		return d.logMount(ctx, tx, actor, via, host, path, &old, nil)
	})
}

// UndoMount restores a mount's value from before its last change.
func (d *Registry) UndoMount(ctx context.Context, actor, via, host, path string) (*Mount, error) {
	var restored *Mount
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var before sql.NullString
		err := tx.QueryRowContext(ctx, `SELECT before FROM mount_log WHERE host = ? AND path = ? ORDER BY id DESC LIMIT 1`, host, path).Scan(&before)
		if errors.Is(err, sql.ErrNoRows) {
			return sysdb.ErrNotFound
		}
		if err != nil {
			return err
		}
		var cur *Mount
		if old, err := scanMount(tx.QueryRowContext(ctx, `SELECT `+mountCols+` FROM mounts WHERE host = ? AND path = ?`, host, path)); err == nil {
			cur = &old
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM mounts WHERE host = ? AND path = ?`, host, path); err != nil {
			return err
		}
		if before.Valid && before.String != "" {
			var m Mount
			if err := json.Unmarshal([]byte(before.String), &m); err != nil {
				return err
			}
			m.ChangedBy, m.ChangedAt = actor, d.NowMs()
			if _, err := tx.ExecContext(ctx, `INSERT INTO mounts (host, path, store, store_param, type, create_app, create_audience, aliases, changed_by, changed_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, m.Host, m.Path, sysdb.NullStr(m.Store), sysdb.NullStr(m.StoreParam), sysdb.NullStr(m.Type),
				sysdb.NullStr(m.CreateApp), sysdb.NullStr(m.CreateAudience), aliasesJSON(m.Aliases), sysdb.NullStr(actor), m.ChangedAt); err != nil {
				return err
			}
			restored = &m
		}
		return d.logMount(ctx, tx, actor, via, host, path, cur, restored)
	})
	return restored, err
}

func (d *Registry) logMount(ctx context.Context, tx *sql.Tx, actor, via, host, path string, before, after *Mount) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO mount_log (host, path, before, after, by, at) VALUES (?, ?, ?, ?, ?, ?)`,
		host, path, sysdb.NullStr(mountJSON(before)), sysdb.NullStr(mountJSON(after)), sysdb.NullStr(actor), d.NowMs()); err != nil {
		return err
	}
	op, summary := "set", "mounted "+host+path
	switch {
	case after == nil:
		op, summary = "remove", "unmounted "+host+path
	case after.Store != "":
		summary += " → " + after.Store
	default:
		summary += " → :" + after.StoreParam
	}
	_, err := sysdb.Log(ctx, tx, d.NowMs(), actor, via, summary, sysdb.Change{Kind: "mount", Key: host + path, Op: op, Before: mountJSON(before), After: mountJSON(after)})
	return err
}

// Match is a mount matched against a request path.
type Match struct {
	Mount  Mount
	Params map[string]string
	Rest   string // the path below the mount, without a leading slash
	Base   string // the request path the mount matched, without a trailing slash
}

// BestMount finds the mount for a path: literal segments beat :params,
// which beat *; among equals the longer pattern wins. A mount matches its
// path and everything below it.
func BestMount(mounts []Mount, reqPath string) (Match, bool) {
	segs := splitPath(reqPath)
	type cand struct {
		m     Match
		score []int
	}
	var best *cand
	for _, m := range mounts {
		pat := splitPath(m.Path)
		if len(pat) > 0 && pat[len(pat)-1] == "*" {
			pat = pat[:len(pat)-1]
		}
		if len(pat) > len(segs) {
			continue
		}
		params := map[string]string{}
		score := make([]int, 0, len(pat)+1)
		ok := true
		for i, p := range pat {
			switch {
			case strings.HasPrefix(p, ":"):
				params[p[1:]] = segs[i]
				score = append(score, 1)
			case p == segs[i]:
				score = append(score, 2)
			default:
				ok = false
			}
			if !ok {
				break
			}
		}
		if !ok {
			continue
		}
		c := &cand{m: Match{Mount: m, Params: params, Rest: strings.Join(segs[len(pat):], "/"),
			Base: "/" + strings.Join(segs[:len(pat)], "/")}, score: score}
		if best == nil || better(c.score, best.score) {
			best = c
		}
	}
	if best == nil {
		return Match{}, false
	}
	return best.m, true
}

// better compares match scores segment by segment, then by length.
func better(a, b []int) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return len(a) > len(b)
}

func splitPath(p string) []string {
	p = strings.Trim(p, "/")
	if p == "" {
		return nil
	}
	return strings.Split(p, "/")
}
