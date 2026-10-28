package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"time"

	"github.com/pkg/errors"
)

// Artifact kinds.
const (
	KindPage = "page"
	KindData = "data"
)

var artifactID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)

// ValidArtifactID reports whether id is an acceptable artifact identifier.
func ValidArtifactID(id string) bool { return artifactID.MatchString(id) }

// Artifact is a named, versioned page or data collection. Main is the
// version the main ref points at (0 before the first push); Latest is the
// highest version number.
type Artifact struct {
	ID        string    `json:"id"`
	Title     string    `json:"title"`
	Kind      string    `json:"kind"`
	Type      string    `json:"type,omitempty"`
	Viewer    string    `json:"viewer,omitempty"`
	Project   *string   `json:"project"`
	CreatedBy *string   `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
	Main      int       `json:"main"`
	Latest    int       `json:"latest"`
}

// FileEntry is one file of a version's tree.
type FileEntry struct {
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Type   string `json:"type"`
}

// Version is an immutable snapshot of an artifact: a file tree plus metadata.
type Version struct {
	Artifact    string               `json:"artifact"`
	N           int                  `json:"n"`
	Parent      *int                 `json:"parent"`
	Manifest    JSON                 `json:"manifest"`
	Message     string               `json:"message"`
	Author      string               `json:"by"`
	TokenID     *string              `json:"tokenId,omitempty"`
	Via         string               `json:"via"`
	Session     string               `json:"session,omitempty"`
	ReplyThread string               `json:"reply,omitempty"`
	CreatedAt   time.Time            `json:"at"`
	Files       map[string]FileEntry `json:"files"`
}

const artifactColumns = `a.id,a.title,a.kind,a.type,a.viewer,a.project_id,a.created_by,a.created_at,
COALESCE((SELECT n FROM refs WHERE artifact_id=a.id AND name='main'),0),
COALESCE((SELECT MAX(n) FROM versions WHERE artifact_id=a.id),0)`

func scanArtifact(r scanner) (Artifact, error) {
	var a Artifact
	err := r.Scan(&a.ID, &a.Title, &a.Kind, &a.Type, &a.Viewer, &a.Project, &a.CreatedBy, &a.CreatedAt, &a.Main, &a.Latest)
	return a, notFound(err)
}

// Artifacts lists artifacts, optionally of one project.
func (s *Store) Artifacts(ctx context.Context, project string) ([]Artifact, error) {
	rows, err := s.db().query(ctx, `SELECT `+artifactColumns+` FROM artifacts a WHERE (?='' OR a.project_id=?) ORDER BY a.id`, project, project)
	return scanAll(rows, err, func(r *sql.Rows) (Artifact, error) { return scanArtifact(r) })
}

func (s *Store) Artifact(ctx context.Context, id string) (Artifact, error) {
	return getArtifact(ctx, s.db(), id)
}

func getArtifact(ctx context.Context, d db, id string) (Artifact, error) {
	return scanArtifact(d.row(ctx, `SELECT `+artifactColumns+` FROM artifacts a WHERE a.id=?`, id))
}

// ArtifactInput creates or edits an artifact's metadata.
type ArtifactInput struct {
	Title   string  `json:"title"`
	Kind    string  `json:"kind"`
	Type    string  `json:"type"`
	Viewer  string  `json:"viewer"`
	Project *string `json:"project"`
}

func (in ArtifactInput) validate() error {
	if in.Title == "" || len(in.Title) > 200 {
		return invalidf("a title of 1–200 characters is required")
	}
	if in.Kind != KindPage && in.Kind != KindData {
		return invalidf("kind must be page or data")
	}
	if in.Kind == KindPage && (in.Type != "" || in.Viewer != "") {
		return invalidf("type and viewer are for data artifacts")
	}
	return nil
}

func createArtifact(ctx context.Context, d db, now time.Time, id string, in ArtifactInput, actor string) (Event, error) {
	if !ValidArtifactID(id) {
		return Event{}, invalidf("an artifact id is lowercase letters, digits and -, up to 63 characters")
	}
	if err := in.validate(); err != nil {
		return Event{}, err
	}
	_, err := d.exec(ctx, `INSERT INTO artifacts(id,title,kind,type,viewer,project_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)`,
		id, in.Title, in.Kind, in.Type, in.Viewer, in.Project, nullable(actor), now)
	if isUnique(err) {
		return Event{}, ErrConflict
	}
	if err != nil {
		return Event{}, err
	}
	if err = audit(ctx, d, now, actor, "artifact.create", id, map[string]any{"title": in.Title, "kind": in.Kind}); err != nil {
		return Event{}, err
	}
	a, err := getArtifact(ctx, d, id)
	if err != nil {
		return Event{}, err
	}
	return appendEvent(ctx, d, now, EvArtifactCreated, deref(in.Project), id, actor, a)
}

// CreateArtifact creates an artifact without a version.
func (s *Store) CreateArtifact(ctx context.Context, id string, in ArtifactInput, actor string) (Artifact, []Event, error) {
	var out Artifact
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		ev, err := createArtifact(ctx, tx, s.Now(), id, in, actor)
		if err != nil {
			return err
		}
		evs = append(evs, ev)
		out, err = getArtifact(ctx, tx, id)
		return err
	})
	return out, evs, err
}

// UpdateArtifact changes title, project and viewer; kind and type are fixed.
func (s *Store) UpdateArtifact(ctx context.Context, id string, title, viewer *string, project **string, actor string) (Artifact, []Event, error) {
	var out Artifact
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		a, err := getArtifact(ctx, tx, id)
		if err != nil {
			return err
		}
		if title != nil {
			a.Title = *title
		}
		if viewer != nil {
			a.Viewer = *viewer
		}
		if project != nil {
			a.Project = *project
		}
		if _, err = tx.exec(ctx, `UPDATE artifacts SET title=?, viewer=?, project_id=? WHERE id=?`, a.Title, a.Viewer, a.Project, id); err != nil {
			return err
		}
		now := s.Now()
		if err = audit(ctx, tx, now, actor, "artifact.update", id, map[string]any{"title": a.Title}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvArtifactUpdated, deref(a.Project), id, actor, a)
		evs = append(evs, ev)
		out = a
		return err
	})
	return out, evs, err
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

const versionColumns = `artifact_id,n,parent,manifest,message,author_id,token_id,via,session,reply_thread,created_at`

func scanVersion(r scanner) (Version, error) {
	var v Version
	err := r.Scan(&v.Artifact, &v.N, &v.Parent, &v.Manifest, &v.Message, &v.Author, &v.TokenID, &v.Via, &v.Session, &v.ReplyThread, &v.CreatedAt)
	return v, notFound(err)
}

// Versions lists an artifact's versions with their file trees, oldest first.
func (s *Store) Versions(ctx context.Context, artifact string) ([]Version, error) {
	rows, err := s.db().query(ctx, `SELECT `+versionColumns+` FROM versions WHERE artifact_id=? ORDER BY n`, artifact)
	vs, err := scanAll(rows, err, func(r *sql.Rows) (Version, error) { return scanVersion(r) })
	if err != nil {
		return nil, err
	}
	files, err := s.files(ctx, s.db(), artifact, 0)
	if err != nil {
		return nil, err
	}
	for i := range vs {
		vs[i].Files = files[vs[i].N]
		if vs[i].Files == nil {
			vs[i].Files = map[string]FileEntry{}
		}
	}
	return vs, nil
}

// Version returns one version; n <= 0 means the main ref.
func (s *Store) Version(ctx context.Context, artifact string, n int) (Version, error) {
	return getVersion(ctx, s, s.db(), artifact, n)
}

func getVersion(ctx context.Context, s *Store, d db, artifact string, n int) (Version, error) {
	if n <= 0 {
		if err := d.row(ctx, `SELECT n FROM refs WHERE artifact_id=? AND name='main'`, artifact).Scan(&n); err != nil {
			return Version{}, notFound(err)
		}
	}
	v, err := scanVersion(d.row(ctx, `SELECT `+versionColumns+` FROM versions WHERE artifact_id=? AND n=?`, artifact, n))
	if err != nil {
		return v, err
	}
	files, err := s.files(ctx, d, artifact, n)
	if err != nil {
		return v, err
	}
	v.Files = files[n]
	if v.Files == nil {
		v.Files = map[string]FileEntry{}
	}
	return v, nil
}

// files loads trees by version: one version (n > 0) or all of them.
func (s *Store) files(ctx context.Context, d db, artifact string, n int) (map[int]map[string]FileEntry, error) {
	rows, err := d.query(ctx, `SELECT n,path,sha256,size,media_type FROM version_files WHERE artifact_id=? AND (?=0 OR n=?)`, artifact, n, n)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[int]map[string]FileEntry{}
	for rows.Next() {
		var vn int
		var p string
		var f FileEntry
		if err := rows.Scan(&vn, &p, &f.SHA256, &f.Size, &f.Type); err != nil {
			return nil, err
		}
		if out[vn] == nil {
			out[vn] = map[string]FileEntry{}
		}
		out[vn][p] = f
	}
	return out, rows.Err()
}

// PushInput is one push: a complete file tree for a new version.
type PushInput struct {
	Artifact string
	// Base is the version the tree was edited from; nil for a new artifact.
	Base     *int
	Tree     map[string]FileEntry
	Manifest JSON
	Message  string
	Via      string
	Session  string
	Reply    *ReplyInput
	Create   *ArtifactInput
	// MoveMain moves the main ref to the new version (the default).
	MoveMain bool
	// Force skips the compare-and-set of Base against main.
	Force   bool
	Actor   string
	TokenID string
}

// ReplyInput replies on a thread together with a push.
type ReplyInput struct {
	Thread string `json:"thread"`
	Text   string `json:"text"`
}

// MainMovedError is returned when Base is not main any more.
type MainMovedError struct{ Main int }

func (e *MainMovedError) Error() string {
	return fmt.Sprintf("main is at v%d, not the base you edited; pull, or push with force", e.Main)
}

type PushResult struct {
	Artifact Artifact `json:"artifact"`
	Version  Version  `json:"version"`
	Created  bool     `json:"created"`
	// Unchanged is set when the tree and manifest equal main's: no version
	// is stored and Version is main (re-saves, push --watch).
	Unchanged bool    `json:"unchanged,omitempty"`
	Events    []Event `json:"-"`
}

// Push stores a new version. Pushes to one artifact are serialised (row
// lock on Postgres, the database write lock on SQLite), and the base is
// compared with main unless Force is set.
func (s *Store) Push(ctx context.Context, in PushInput) (PushResult, error) {
	var res PushResult
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		var exists int
		err := tx.row(ctx, tx.forUpdate(`SELECT 1 FROM artifacts WHERE id=?`), in.Artifact).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			if in.Create == nil {
				return ErrNotFound
			}
			ev, err := createArtifact(ctx, tx, now, in.Artifact, *in.Create, in.Actor)
			if err != nil {
				return err
			}
			res.Created = true
			res.Events = append(res.Events, ev)
		} else if err != nil {
			return err
		}
		a, err := getArtifact(ctx, tx, in.Artifact)
		if err != nil {
			return err
		}
		if a.Kind == KindPage {
			if _, ok := in.Tree["index.html"]; !ok {
				return invalidf("a page version needs an index.html")
			}
		}
		if !in.Force && a.Main != 0 && (in.Base == nil || *in.Base != a.Main) {
			return &MainMovedError{Main: a.Main}
		}
		n := a.Latest + 1
		parent := in.Base
		if parent == nil && a.Main != 0 {
			m := a.Main
			parent = &m
		}
		if len(in.Manifest) == 0 {
			in.Manifest = JSON("{}")
		}
		if a.Main != 0 && in.Reply == nil {
			cur, err := getVersion(ctx, s, tx, a.ID, a.Main)
			if err != nil {
				return err
			}
			if sameVersion(cur, in.Tree, in.Manifest) {
				res.Unchanged, res.Version, res.Artifact = true, cur, a
				return nil
			}
		}
		replyThread := ""
		if in.Reply != nil {
			replyThread = in.Reply.Thread
		}
		if _, err = tx.exec(ctx, `INSERT INTO versions(`+versionColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
			a.ID, n, parent, in.Manifest, in.Message, in.Actor, nullable(in.TokenID), in.Via, in.Session, replyThread, now); err != nil {
			return err
		}
		paths := make([]string, 0, len(in.Tree))
		for p := range in.Tree {
			paths = append(paths, p)
		}
		sort.Strings(paths)
		for _, p := range paths {
			f := in.Tree[p]
			if _, err = tx.exec(ctx, `INSERT INTO version_files(artifact_id,n,path,sha256,size,media_type) VALUES(?,?,?,?,?,?)`, a.ID, n, p, f.SHA256, f.Size, f.Type); err != nil {
				return err
			}
		}
		if in.MoveMain {
			if err = setRef(ctx, tx, now, a.ID, "main", n); err != nil {
				return err
			}
		}
		if err = audit(ctx, tx, now, in.Actor, "version.push", fmt.Sprintf("%s v%d", a.ID, n), map[string]any{"message": in.Message, "files": len(in.Tree), "via": in.Via}); err != nil {
			return err
		}
		if res.Version, err = getVersion(ctx, s, tx, a.ID, n); err != nil {
			return err
		}
		if res.Artifact, err = getArtifact(ctx, tx, a.ID); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvVersionCreated, deref(a.Project), a.ID, in.Actor, map[string]any{
			"artifact": a.ID, "n": n, "by": in.Actor, "via": in.Via, "message": in.Message, "main": res.Artifact.Main, "session": in.Session})
		if err != nil {
			return err
		}
		res.Events = append(res.Events, ev)
		if in.Reply != nil {
			_, _, evs, err := reply(ctx, tx, now, in.Reply.Thread, in.Reply.Text, &n, in.Actor, in.TokenID, in.TokenID != "")
			if err != nil {
				return errors.Wrap(err, "reply")
			}
			res.Events = append(res.Events, evs...)
		}
		return nil
	})
	return res, err
}

// sameVersion reports whether a tree and manifest are v's.
func sameVersion(v Version, tree map[string]FileEntry, manifest JSON) bool {
	if len(v.Files) != len(tree) || !jsonEqual(v.Manifest, manifest) {
		return false
	}
	for p, f := range tree {
		if v.Files[p].SHA256 != f.SHA256 {
			return false
		}
	}
	return true
}

func jsonEqual(a, b JSON) bool {
	var x, y any
	if json.Unmarshal(a, &x) != nil || json.Unmarshal(b, &y) != nil {
		return false
	}
	return reflect.DeepEqual(x, y)
}

func setRef(ctx context.Context, d db, now time.Time, artifact, name string, n int) error {
	_, err := d.exec(ctx, `INSERT INTO refs(artifact_id,name,n,updated_at) VALUES(?,?,?,?) ON CONFLICT(artifact_id,name) DO UPDATE SET n=excluded.n, updated_at=excluded.updated_at`,
		artifact, name, n, now)
	return err
}

// SetRef points a ref at a version. When expect is set, the ref must
// currently point there (compare-and-set).
func (s *Store) SetRef(ctx context.Context, artifact, name string, n int, expect *int, actor string) (Artifact, []Event, error) {
	var out Artifact
	var evs []Event
	err := s.InTx(ctx, func(tx db) error {
		now := s.Now()
		a, err := getArtifact(ctx, tx, artifact)
		if err != nil {
			return err
		}
		var cur int
		err = tx.row(ctx, tx.forUpdate(`SELECT n FROM refs WHERE artifact_id=? AND name=?`), artifact, name).Scan(&cur)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if expect != nil && *expect != cur {
			return &MainMovedError{Main: cur}
		}
		var exists int
		if err = tx.row(ctx, `SELECT 1 FROM versions WHERE artifact_id=? AND n=?`, artifact, n).Scan(&exists); err != nil {
			return notFound(err)
		}
		if err = setRef(ctx, tx, now, artifact, name, n); err != nil {
			return err
		}
		if err = audit(ctx, tx, now, actor, "ref.move", artifact, map[string]any{"ref": name, "from": cur, "to": n}); err != nil {
			return err
		}
		ev, err := appendEvent(ctx, tx, now, EvRefMoved, deref(a.Project), artifact, actor, map[string]any{"artifact": artifact, "ref": name, "from": cur, "to": n})
		evs = append(evs, ev)
		if err != nil {
			return err
		}
		out, err = getArtifact(ctx, tx, artifact)
		return err
	})
	return out, evs, err
}

// ReferencedBlobs reports whether any version uses sum.
func (s *Store) ReferencedBlobs(ctx context.Context, sum string) (bool, error) {
	var n int
	err := s.db().row(ctx, `SELECT COUNT(*) FROM version_files WHERE sha256=?`, sum).Scan(&n)
	return n > 0, err
}

// ManifestOf decodes a version's manifest into dst.
func ManifestOf(v Version, dst any) error {
	if len(v.Manifest) == 0 {
		return nil
	}
	return json.Unmarshal(v.Manifest, dst)
}
