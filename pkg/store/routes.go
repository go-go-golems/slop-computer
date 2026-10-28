package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// Binding says which version of a data artifact a page's read-name means on
// a route. Version nil follows the data artifact's main.
type Binding struct {
	Artifact string `json:"artifact"`
	Version  *int   `json:"version"`
}

// Route maps (host, path pattern) to a page artifact, following main
// (Version nil) or pinned to a version.
type Route struct {
	Host      string             `json:"host"`
	Path      string             `json:"path"`
	Page      string             `json:"page"`
	Version   *int               `json:"version"`
	Bindings  map[string]Binding `json:"bindings"`
	Record    string             `json:"record,omitempty"`
	Access    string             `json:"access"`
	ChangedBy *string            `json:"changedBy"`
	ChangedAt time.Time          `json:"changedAt"`
}

// RouteLogEntry is one change of a route: From and To are the route before
// and after (nil when it did not exist).
type RouteLogEntry struct {
	ID        int64     `json:"id"`
	Host      string    `json:"host"`
	Path      string    `json:"path"`
	From      *Route    `json:"from"`
	To        *Route    `json:"to"`
	Note      string    `json:"note"`
	By        *string   `json:"by"`
	Via       string    `json:"via"`
	CreatedAt time.Time `json:"at"`
}

var (
	hostPattern    = regexp.MustCompile(`^[a-z0-9.-]+(:[0-9]{1,5})?$`)
	segmentPattern = regexp.MustCompile(`^(\*|:[a-zA-Z_][a-zA-Z0-9_]*|[A-Za-z0-9._~!$&'()+,;=@%-]+)$`)
)

// ValidRoutePath accepts "*" (the fallback) and paths like /journal/:slug or
// /files/*, where * may only be the last segment.
func ValidRoutePath(p string) bool {
	if p == "*" || p == "/" {
		return true
	}
	if !strings.HasPrefix(p, "/") || strings.HasSuffix(p, "/") || len(p) > 300 {
		return false
	}
	segs := strings.Split(p[1:], "/")
	for i, s := range segs {
		if !segmentPattern.MatchString(s) || (s == "*" && i != len(segs)-1) {
			return false
		}
	}
	return true
}

func (r *Route) validate() error {
	r.Host = strings.ToLower(strings.TrimSpace(r.Host))
	if !hostPattern.MatchString(r.Host) {
		return invalidf("host must be a host name such as slop.boutique or site.localhost:8080")
	}
	if !ValidRoutePath(r.Path) {
		return invalidf("path must be /, *, or /segments with :params and an optional trailing *")
	}
	if r.Access == "" {
		r.Access = "public"
	}
	if r.Access != "public" && r.Access != "admins" {
		return invalidf("access must be public or admins")
	}
	if r.Bindings == nil {
		r.Bindings = map[string]Binding{}
	}
	return nil
}

const routeColumns = `host,path,page,version,bindings,record,access,changed_by,changed_at`

func scanRoute(r scanner) (Route, error) {
	var rt Route
	var bindings JSON
	err := r.Scan(&rt.Host, &rt.Path, &rt.Page, &rt.Version, &bindings, &rt.Record, &rt.Access, &rt.ChangedBy, &rt.ChangedAt)
	if err != nil {
		return rt, notFound(err)
	}
	rt.Bindings = map[string]Binding{}
	if len(bindings) > 0 {
		err = json.Unmarshal(bindings, &rt.Bindings)
	}
	return rt, err
}

// Routes lists the routes of one host, or of every host when host is "".
func (s *Store) Routes(ctx context.Context, host string) ([]Route, error) {
	rows, err := s.db().query(ctx, `SELECT `+routeColumns+` FROM routes WHERE (?='' OR host=?) ORDER BY host, path`, host, host)
	return scanAll(rows, err, func(r *sql.Rows) (Route, error) { return scanRoute(r) })
}

func getRoute(ctx context.Context, d db, host, path string) (*Route, error) {
	r, err := scanRoute(d.row(ctx, d.forUpdate(`SELECT `+routeColumns+` FROM routes WHERE host=? AND path=?`), host, path))
	if errors.Is(err, ErrNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// SetRoute creates or replaces a route and logs the change.
func (s *Store) SetRoute(ctx context.Context, r Route, note, actor string) (Route, []Event, error) {
	if err := r.validate(); err != nil {
		return Route{}, nil, err
	}
	var out Route
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		var err error
		out, evs, err = setRoute(ctx, s, tx, r, note, actor)
		return err
	})
	return out, evs, err
}

func setRoute(ctx context.Context, s *Store, tx db, r Route, note, actor string) (Route, []Event, error) {
	now := s.Now()
	page, err := getArtifact(ctx, tx, r.Page)
	if errors.Is(err, ErrNotFound) {
		return Route{}, nil, invalidf("no artifact %q", r.Page)
	}
	if err != nil {
		return Route{}, nil, err
	}
	if page.Kind != KindPage {
		return Route{}, nil, invalidf("%s is a data artifact; routes serve pages", r.Page)
	}
	if r.Version != nil {
		var one int
		if err = tx.row(ctx, `SELECT 1 FROM versions WHERE artifact_id=? AND n=?`, r.Page, *r.Version).Scan(&one); err != nil {
			return Route{}, nil, invalidf("%s has no version %d", r.Page, *r.Version)
		}
	}
	for name, b := range r.Bindings {
		a, err := getArtifact(ctx, tx, b.Artifact)
		if err != nil || a.Kind != KindData {
			return Route{}, nil, invalidf("binding %s: %q is not a data artifact", name, b.Artifact)
		}
	}
	from, err := getRoute(ctx, tx, r.Host, r.Path)
	if err != nil {
		return Route{}, nil, err
	}
	bindings := MustJSON(r.Bindings)
	if _, err = tx.exec(ctx, `INSERT INTO routes(`+routeColumns+`) VALUES(?,?,?,?,?,?,?,?,?)
ON CONFLICT(host,path) DO UPDATE SET page=excluded.page, version=excluded.version, bindings=excluded.bindings, record=excluded.record,
access=excluded.access, changed_by=excluded.changed_by, changed_at=excluded.changed_at`,
		r.Host, r.Path, r.Page, r.Version, bindings, r.Record, r.Access, nullable(actor), now); err != nil {
		return Route{}, nil, err
	}
	to, err := getRoute(ctx, tx, r.Host, r.Path)
	if err != nil {
		return Route{}, nil, err
	}
	evs, err := logRoute(ctx, s, tx, now, from, to, r.Host, r.Path, note, actor, deref(page.Project))
	return *to, evs, err
}

func logRoute(ctx context.Context, s *Store, tx db, now time.Time, from, to *Route, host, path, note, actor, project string) ([]Event, error) {
	enc := func(r *Route) any {
		if r == nil {
			return nil
		}
		return MustJSON(r)
	}
	if _, err := tx.exec(ctx, `INSERT INTO route_log(host,path,from_state,to_state,note,by_user,via,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		host, path, enc(from), enc(to), note, nullable(actor), AuditVia(ctx), now); err != nil {
		return nil, err
	}
	typ, action := EvRouteSet, "route.set"
	if to == nil {
		typ, action = EvRouteRemoved, "route.remove"
	}
	if err := audit(ctx, tx, now, actor, action, host+path, map[string]any{"from": from, "to": to, "note": note}); err != nil {
		return nil, err
	}
	ev, err := appendEvent(ctx, tx, now, typ, project, "", actor, map[string]any{"host": host, "path": path, "route": to, "from": from, "note": note})
	return []Event{ev}, err
}

// RemoveRoute deletes a route and logs the change.
func (s *Store) RemoveRoute(ctx context.Context, host, path, note, actor string) ([]Event, error) {
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		var err error
		evs, err = removeRoute(ctx, s, tx, host, path, note, actor)
		return err
	})
	return evs, err
}

func removeRoute(ctx context.Context, s *Store, tx db, host, path, note, actor string) ([]Event, error) {
	from, err := getRoute(ctx, tx, host, path)
	if err != nil {
		return nil, err
	}
	if from == nil {
		return nil, ErrNotFound
	}
	if _, err = tx.exec(ctx, `DELETE FROM routes WHERE host=? AND path=?`, host, path); err != nil {
		return nil, err
	}
	project := ""
	if a, err := getArtifact(ctx, tx, from.Page); err == nil {
		project = deref(a.Project)
	}
	return logRoute(ctx, s, tx, s.Now(), from, nil, host, path, note, actor, project)
}

func scanRouteLog(r scanner) (RouteLogEntry, error) {
	var e RouteLogEntry
	var from, to *string
	err := r.Scan(&e.ID, &e.Host, &e.Path, &from, &to, &e.Note, &e.By, &e.Via, &e.CreatedAt)
	if err != nil {
		return e, err
	}
	dec := func(s *string) (*Route, error) {
		if s == nil {
			return nil, nil
		}
		var r Route
		return &r, json.Unmarshal([]byte(*s), &r)
	}
	if e.From, err = dec(from); err != nil {
		return e, err
	}
	e.To, err = dec(to)
	return e, err
}

// RouteLog lists changes, newest first, of one route or (host "" and path
// "") of all routes.
func (s *Store) RouteLog(ctx context.Context, host, path string, limit int) ([]RouteLogEntry, error) {
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	rows, err := s.db().query(ctx, `SELECT id,host,path,from_state,to_state,note,by_user,via,created_at FROM route_log
WHERE (?='' OR host=?) AND (?='' OR path=?) ORDER BY id DESC LIMIT ?`, host, host, path, path, limit)
	return scanAll(rows, err, func(r *sql.Rows) (RouteLogEntry, error) { return scanRouteLog(r) })
}

// UndoRoute restores a route to its state before its last change.
func (s *Store) UndoRoute(ctx context.Context, host, path, actor string) (*Route, []Event, error) {
	var out *Route
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		last, err := scanRouteLog(tx.row(ctx, `SELECT id,host,path,from_state,to_state,note,by_user,via,created_at FROM route_log
WHERE host=? AND path=? ORDER BY id DESC LIMIT 1`, host, path))
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		note := "undo"
		if last.From == nil {
			evs, err = removeRoute(ctx, s, tx, host, path, note, actor)
			return err
		}
		r, e, err := setRoute(ctx, s, tx, *last.From, note, actor)
		out, evs = &r, e
		return err
	})
	return out, evs, err
}
