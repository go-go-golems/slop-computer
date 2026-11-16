package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"path"
	"regexp"
	"strconv"
	"strings"
)

func stringsReader(s string) io.Reader { return strings.NewReader(s) }

// File is one file's metadata.
type File struct {
	Zone   string `json:"zone,omitempty"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Type   string `json:"type"`
	Rev    int64  `json:"rev,omitempty"`
}

// Limits for files.
const (
	MaxTreeFile   = 50 << 20
	MaxAssetFile  = 20 << 20
	MaxTreeFiles  = 5000
	maxPathLength = 512
)

// ValidFilePath reports a clean relative path.
func ValidFilePath(p string) bool {
	if p == "" || len(p) > maxPathLength || strings.HasPrefix(p, "/") || strings.Contains(p, "\\") || strings.Contains(p, "\x00") {
		return false
	}
	return path.Clean(p) == p && !strings.HasPrefix(p, "../") && p != ".." && p != "."
}

// fileTypes are the types slop names itself. Go's mime package knows only a
// short built-in list (html, css, js, json, images, pdf, wasm, xml) and
// takes the rest from the host's mime.types, which the slop image does not
// have: there a .woff2 was served as application/octet-stream (SLOP3-021).
var fileTypes = map[string]string{
	".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".json": "application/json", ".md": "text/markdown; charset=utf-8",
	".sql": "application/sql", ".wasm": "application/wasm",
	".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
	".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
	".ico": "image/vnd.microsoft.icon",
	".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
	".zip": "application/zip",
}

// TypeOf guesses a content type from a file name.
func TypeOf(name string) string {
	if t, ok := fileTypes[strings.ToLower(path.Ext(name))]; ok {
		return t
	}
	if t := mime.TypeByExtension(path.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}

// PutFile stores bytes in a zone (tree or assets) at path.
func (t *Turn) PutFile(zone, p string, data []byte, ctype string) (File, error) {
	if err := checkFile(zone, p, int64(len(data))); err != nil {
		return File{}, err
	}
	sum, err := t.s.Blobs.Put(data)
	if err != nil {
		return File{}, err
	}
	return t.PutBlob(zone, p, sum, int64(len(data)), ctype)
}

func checkFile(zone, p string, size int64) error {
	if zone != "tree" && zone != "assets" {
		return fmt.Errorf("zone must be tree or assets")
	}
	if !ValidFilePath(p) {
		return fmt.Errorf("invalid file path %q", p)
	}
	if (zone == "tree" && size > MaxTreeFile) || (zone == "assets" && size > MaxAssetFile) {
		return fmt.Errorf("file %s is too large", p)
	}
	return nil
}

// PutBlob points a zone path at a blob already in the blob store.
func (t *Turn) PutBlob(zone, p, sum string, size int64, ctype string) (File, error) {
	if err := checkFile(zone, p, size); err != nil {
		return File{}, err
	}
	if zone == "tree" {
		if err := t.guardCode(p); err != nil {
			return File{}, err
		}
	}
	if n, ok := t.s.Blobs.Stat(sum); !ok || n != size {
		return File{}, fmt.Errorf("no blob %s of %d bytes for %s", sum, size, p)
	}
	if ctype == "" {
		ctype = TypeOf(p)
	}
	f := File{Zone: zone, Path: p, SHA256: sum, Size: size, Type: ctype, Rev: t.Rev}
	var old, oldType string
	_ = t.s.w.QueryRowContext(t.ctx, `SELECT sha256, type FROM _files WHERE zone = ? AND path = ?`, zone, p).Scan(&old, &oldType)
	if old == sum && oldType == ctype {
		return f, nil // unchanged
	}
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _files (zone, path, sha256, size, type, rev, by, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (zone, path) DO UPDATE SET sha256 = excluded.sha256, size = excluded.size, type = excluded.type,
		rev = excluded.rev, by = excluded.by, at = excluded.at`,
		zone, p, sum, size, ctype, t.Rev, nullStr(t.Who.ID), t.Now); err != nil {
		return File{}, err
	}
	t.record(Change{Kind: "file", Key: zone + ":" + p, Op: "put"})
	return f, nil
}

// RemoveFile deletes a file from a zone.
func (t *Turn) RemoveFile(zone, p string) (bool, error) {
	if zone == "tree" {
		if err := t.guardCode(p); err != nil {
			return false, err
		}
	}
	res, err := t.s.w.ExecContext(t.ctx, `DELETE FROM _files WHERE zone = ? AND path = ?`, zone, p)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		t.record(Change{Kind: "file", Key: zone + ":" + p, Op: "remove"})
	}
	return n > 0, nil
}

// Files lists a zone's current files under a prefix.
func (s *Store) Files(ctx context.Context, zone, prefix string) ([]File, error) {
	rows, err := s.ro.QueryContext(ctx, `SELECT zone, path, sha256, size, type, rev FROM _files WHERE zone = ? AND path LIKE ? ESCAPE '\' ORDER BY path`,
		zone, likePrefix(prefix))
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []File{}
	for rows.Next() {
		var f File
		if err := rows.Scan(&f.Zone, &f.Path, &f.SHA256, &f.Size, &f.Type, &f.Rev); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// TreeFiles lists the working tree inside the turn.
func (t *Turn) TreeFiles() ([]File, error) { return t.ZoneFiles("tree") }

// ZoneFiles lists a zone's files inside the turn.
func (t *Turn) ZoneFiles(zone string) ([]File, error) {
	rows, err := t.s.w.QueryContext(t.ctx, `SELECT path, sha256, size, type FROM _files WHERE zone = ? ORDER BY path`, zone)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []File{}
	for rows.Next() {
		f := File{Zone: zone}
		if err := rows.Scan(&f.Path, &f.SHA256, &f.Size, &f.Type); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// Snapshot freezes the tree zone as snapshot n and moves ref (default main)
// to it. When the ref already points at an identical tree, nothing is
// written and that snapshot's number is returned.
func (t *Turn) Snapshot(message, ref string) (int64, error) {
	if ref == "" {
		ref = "main"
	}
	if err := t.guardCode(); err != nil {
		return 0, err
	}
	files, err := t.TreeFiles()
	if err != nil {
		return 0, err
	}
	if len(files) > MaxTreeFiles {
		return 0, fmt.Errorf("a tree holds at most %d files", MaxTreeFiles)
	}
	h := sha256.New()
	for _, f := range files {
		fmt.Fprintf(h, "%s\t%s\n", f.Path, f.SHA256)
	}
	tree := hex.EncodeToString(h.Sum(nil))
	var n int64
	err = t.s.w.QueryRowContext(t.ctx, `SELECT s.n FROM _refs r JOIN _snapshots s ON s.n = r.n WHERE r.name = ? AND s.tree = ?`, ref, tree).Scan(&n)
	if err == nil {
		return n, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	if err := t.s.w.QueryRowContext(t.ctx, `SELECT coalesce(max(n), 0) + 1 FROM _snapshots`).Scan(&n); err != nil {
		return 0, err
	}
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _snapshots (n, rev, tree, message, by, at) VALUES (?, ?, ?, ?, ?, ?)`,
		n, t.Rev, tree, message, nullStr(t.Who.ID), t.Now); err != nil {
		return 0, err
	}
	for _, f := range files {
		if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _snapshot_files (n, path, sha256, size, type) VALUES (?, ?, ?, ?, ?)`,
			n, f.Path, f.SHA256, f.Size, f.Type); err != nil {
			return 0, err
		}
	}
	t.record(Change{Kind: "snapshot", Key: strconv.FormatInt(n, 10), Op: "create"})
	if err := t.MoveRef(ref, n); err != nil {
		return 0, err
	}
	return n, nil
}

// refNameRe is what a ref may be called: lowercase, starting with a letter,
// up to four /-separated segments of at most 63 characters (draft, main,
// proposal/p8k2x1). A name never starts with a digit, so Store.Ref can
// tell a ref from a snapshot number.
var refNameRe = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,62}(/[a-z0-9][a-z0-9._-]{0,62}){0,3}$`)

// ValidRefName reports whether name may be given to a ref.
func ValidRefName(name string) bool { return refNameRe.MatchString(name) }

// RefAt is the snapshot a ref points at inside this turn (0 if the ref does
// not exist), for compare-and-swap moves.
func (t *Turn) RefAt(ref string) (int64, error) {
	var n int64
	err := t.s.w.QueryRowContext(t.ctx, `SELECT n FROM _refs WHERE name = ?`, ref).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return n, err
}

// HasSnapshot reports whether snapshot n exists, inside the turn.
func (t *Turn) HasSnapshot(n int64) (bool, error) {
	var c int
	err := t.s.w.QueryRowContext(t.ctx, `SELECT count(*) FROM _snapshots WHERE n = ?`, n).Scan(&c)
	return c > 0, err
}

// SnapshotFiles lists the files of snapshot n inside the turn, by path
// (n = 0, "no snapshot", has none).
func (t *Turn) SnapshotFiles(n int64) ([]File, error) { return snapshotFiles(t.ctx, t.s.w, n) }

// ResetTree makes the tree zone hold exactly the files of snapshot n (n =
// 0: no files). It writes only the paths that differ, so a tree already
// at n is left alone and the turn records no change for it.
func (t *Turn) ResetTree(n int64) error {
	want, err := t.SnapshotFiles(n)
	if err != nil {
		return err
	}
	cur, err := t.TreeFiles()
	if err != nil {
		return err
	}
	have := make(map[string]File, len(cur))
	for _, f := range cur {
		have[f.Path] = f
	}
	keep := make(map[string]bool, len(want))
	for _, f := range want {
		keep[f.Path] = true
		if h, ok := have[f.Path]; !ok || h.SHA256 != f.SHA256 || h.Type != f.Type {
			if _, err := t.PutBlob("tree", f.Path, f.SHA256, f.Size, f.Type); err != nil {
				return err
			}
		}
	}
	for _, f := range cur {
		if !keep[f.Path] {
			if _, err := t.RemoveFile("tree", f.Path); err != nil {
				return err
			}
		}
	}
	return nil
}

// MoveRef points a ref at snapshot n, creating the ref when it does not
// exist; the name must be a ValidRefName.
func (t *Turn) MoveRef(ref string, n int64) error {
	if !ValidRefName(ref) {
		return fmt.Errorf("invalid ref name %q (lowercase, starting with a letter: main, draft, proposal/x1)", ref)
	}
	if ok, err := t.HasSnapshot(n); err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("no snapshot %d", n)
	}
	if err := t.guardCode(); err != nil {
		return err
	}
	if !t.Who.Code.OK() && t.snapshotHoldsApp(n) {
		return ErrAppCode
	}
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _refs (name, n, at, by) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET n = excluded.n, at = excluded.at, by = excluded.by`,
		ref, n, t.Now, nullStr(t.Who.ID)); err != nil {
		return err
	}
	t.record(Change{Kind: "ref", Key: ref, Op: "move", Version: n})
	return nil
}

// RemoveRef deletes a ref; its snapshots stay. It reports whether the ref
// existed. Like every ref writer it refuses, without the code right, a
// store that holds app code.
func (t *Turn) RemoveRef(ref string) (bool, error) {
	if err := t.guardCode(); err != nil {
		return false, err
	}
	res, err := t.s.w.ExecContext(t.ctx, `DELETE FROM _refs WHERE name = ?`, ref)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	if n > 0 {
		t.record(Change{Kind: "ref", Key: ref, Op: "remove"})
	}
	return n > 0, nil
}

// Snapshot is one frozen tree.
type Snapshot struct {
	N       int64  `json:"n"`
	Rev     int64  `json:"rev"`
	Tree    string `json:"tree"`
	Message string `json:"message"`
	By      string `json:"by,omitempty"`
	At      int64  `json:"at"`
}

// Snapshots lists snapshots, newest first.
func (s *Store) Snapshots(ctx context.Context) ([]Snapshot, error) {
	rows, err := s.ro.QueryContext(ctx, `SELECT n, rev, tree, message, coalesce(by, ''), at FROM _snapshots ORDER BY n DESC`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []Snapshot{}
	for rows.Next() {
		var x Snapshot
		if err := rows.Scan(&x.N, &x.Rev, &x.Tree, &x.Message, &x.By, &x.At); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// Refs returns every ref and its snapshot.
func (s *Store) Refs(ctx context.Context) (map[string]int64, error) {
	rows, err := s.ro.QueryContext(ctx, `SELECT name, n FROM _refs ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := map[string]int64{}
	for rows.Next() {
		var name string
		var n int64
		if err := rows.Scan(&name, &n); err != nil {
			return nil, err
		}
		out[name] = n
	}
	return out, rows.Err()
}

// Ref resolves a ref name or a number to a snapshot number.
func (s *Store) Ref(ctx context.Context, at string) (int64, error) {
	if at == "" {
		at = "main"
	}
	if n, err := strconv.ParseInt(at, 10, 64); err == nil {
		return n, nil
	}
	var n int64
	err := s.ro.QueryRowContext(ctx, `SELECT n FROM _refs WHERE name = ?`, at).Scan(&n)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return n, err
}

// SnapshotFiles lists the files of snapshot n.
func (s *Store) SnapshotFiles(ctx context.Context, n int64) ([]File, error) {
	return snapshotFiles(ctx, s.ro, n)
}

func snapshotFiles(ctx context.Context, q querier, n int64) ([]File, error) {
	rows, err := q.QueryContext(ctx, `SELECT path, sha256, size, type FROM _snapshot_files WHERE n = ? ORDER BY path`, n)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []File{}
	for rows.Next() {
		f := File{Zone: "tree"}
		if err := rows.Scan(&f.Path, &f.SHA256, &f.Size, &f.Type); err != nil {
			return nil, err
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

// SnapshotFile returns one file of snapshot n.
func (s *Store) SnapshotFile(ctx context.Context, n int64, p string) (File, error) {
	f := File{Zone: "tree", Path: p}
	err := s.ro.QueryRowContext(ctx, `SELECT sha256, size, type FROM _snapshot_files WHERE n = ? AND path = ?`, n, p).Scan(&f.SHA256, &f.Size, &f.Type)
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	return f, err
}

// File returns one current file of a zone.
func (s *Store) File(ctx context.Context, zone, p string) (File, error) {
	f := File{Zone: zone, Path: p}
	err := s.ro.QueryRowContext(ctx, `SELECT sha256, size, type, rev FROM _files WHERE zone = ? AND path = ?`, zone, p).Scan(&f.SHA256, &f.Size, &f.Type, &f.Rev)
	if errors.Is(err, sql.ErrNoRows) {
		return f, ErrNotFound
	}
	return f, err
}

// ReadFile returns a file's bytes.
func (s *Store) ReadFile(f File) ([]byte, error) { return s.Blobs.Read(f.SHA256) }

// Log returns commits after rev (oldest first), at most limit.
func (s *Store) Log(ctx context.Context, after int64, limit int) ([]Commit, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.ro.QueryContext(ctx, `SELECT rev, at, principal, via, coalesce(app, ''), summary FROM _log WHERE rev > ? ORDER BY rev LIMIT ?`, after, limit)
	if err != nil {
		return nil, err
	}
	out := []Commit{}
	if err := func() error {
		defer func() { _ = rows.Close() }()
		for rows.Next() {
			c := Commit{Store: s.ID}
			if err := rows.Scan(&c.Rev, &c.At, &c.Principal, &c.Via, &c.App, &c.Summary); err != nil {
				return err
			}
			out = append(out, c)
		}
		return rows.Err()
	}(); err != nil {
		return nil, err
	}
	epoch := s.Epoch()
	for i := range out {
		out[i].Epoch = epoch
		changes, err := s.changesOf(ctx, out[i].Rev)
		if err != nil {
			return nil, err
		}
		out[i].Changes = changes
	}
	return out, nil
}

// changesOf is one commit's changes, in order.
func (s *Store) changesOf(ctx context.Context, rev int64) ([]Change, error) {
	cr, err := s.ro.QueryContext(ctx, `SELECT kind, key, op, coalesce(version, 0) FROM _changes WHERE rev = ? ORDER BY seq`, rev)
	if err != nil {
		return nil, err
	}
	defer func() { _ = cr.Close() }()
	var out []Change
	for cr.Next() {
		var ch Change
		if err := cr.Scan(&ch.Kind, &ch.Key, &ch.Op, &ch.Version); err != nil {
			return nil, err
		}
		out = append(out, ch)
	}
	return out, cr.Err()
}

// RecentLog returns the newest commits, newest first.
func (s *Store) RecentLog(ctx context.Context, limit int) ([]Commit, error) {
	head := s.Head()
	from := head - int64(limit)
	if from < 0 {
		from = 0
	}
	cs, err := s.Log(ctx, from, limit)
	for i, j := 0, len(cs)-1; i < j; i, j = i+1, j-1 {
		cs[i], cs[j] = cs[j], cs[i]
	}
	return cs, err
}

// appFile is apps.File, the manifest that makes a tree app code.
const appFile = "app.json"

// ErrAppCode refuses a change to app code made without the code right.
var ErrAppCode = errors.New("only admins change app code (this store holds app.json; decision D9)")

// guardCode refuses, without the code right, a change to the tree or refs
// of a store that holds app code (its tree or main holds app.json) and any
// write of app.json itself. Every tree and ref writer calls it, so no
// caller can forget it.
func (t *Turn) guardCode(paths ...string) error {
	if t.Who.Code.OK() {
		return nil
	}
	for _, p := range paths {
		if p == appFile {
			return ErrAppCode
		}
	}
	var n int
	_ = t.s.w.QueryRowContext(t.ctx, `SELECT count(*) FROM _files WHERE zone = 'tree' AND path = ?`, appFile).Scan(&n)
	if n > 0 {
		return ErrAppCode
	}
	var main int64
	if err := t.s.w.QueryRowContext(t.ctx, `SELECT n FROM _refs WHERE name = 'main'`).Scan(&main); err == nil && t.snapshotHoldsApp(main) {
		return ErrAppCode
	}
	return nil
}

// snapshotHoldsApp reports whether snapshot n holds app.json.
func (t *Turn) snapshotHoldsApp(n int64) bool {
	var c int
	_ = t.s.w.QueryRowContext(t.ctx, `SELECT count(*) FROM _snapshot_files WHERE n = ? AND path = ?`, n, appFile).Scan(&c)
	return c > 0
}
