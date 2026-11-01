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

// TypeOf guesses a content type from a file name.
func TypeOf(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".js", ".mjs":
		return "text/javascript; charset=utf-8"
	case ".json":
		return "application/json"
	case ".md":
		return "text/markdown; charset=utf-8"
	case ".sql":
		return "application/sql"
	case ".wasm":
		return "application/wasm"
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
	defer rows.Close()
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
	defer rows.Close()
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

// MoveRef points a ref at snapshot n.
func (t *Turn) MoveRef(ref string, n int64) error {
	var exists int
	if err := t.s.w.QueryRowContext(t.ctx, `SELECT count(*) FROM _snapshots WHERE n = ?`, n).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return fmt.Errorf("no snapshot %d", n)
	}
	if _, err := t.s.w.ExecContext(t.ctx, `INSERT INTO _refs (name, n, at, by) VALUES (?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET n = excluded.n, at = excluded.at, by = excluded.by`,
		ref, n, t.Now, nullStr(t.Who.ID)); err != nil {
		return err
	}
	t.record(Change{Kind: "ref", Key: ref, Op: "move", Version: n})
	return nil
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
	defer rows.Close()
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
	defer rows.Close()
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
	rows, err := s.ro.QueryContext(ctx, `SELECT path, sha256, size, type FROM _snapshot_files WHERE n = ? ORDER BY path`, n)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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
	for rows.Next() {
		c := Commit{Store: s.ID}
		if err := rows.Scan(&c.Rev, &c.At, &c.Principal, &c.Via, &c.App, &c.Summary); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, c)
	}
	rows.Close()
	epoch := s.Epoch()
	for i := range out {
		out[i].Epoch = epoch
		cr, err := s.ro.QueryContext(ctx, `SELECT kind, key, op, coalesce(version, 0) FROM _changes WHERE rev = ? ORDER BY seq`, out[i].Rev)
		if err != nil {
			return nil, err
		}
		for cr.Next() {
			var ch Change
			if err := cr.Scan(&ch.Kind, &ch.Key, &ch.Op, &ch.Version); err != nil {
				cr.Close()
				return nil, err
			}
			out[i].Changes = append(out[i].Changes, ch)
		}
		cr.Close()
	}
	return out, nil
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
