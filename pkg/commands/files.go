package commands

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func filesVerbs(e kernelEnv) []*verbs.Verb {
	storeArg := verbs.Arg{Name: "store", Type: "string", Pos: 1, Required: true}
	zoneArg := verbs.Arg{Name: "zone", Type: "string", Doc: "tree (default) or assets"}
	atArg := verbs.Arg{Name: "at", Type: "string", Doc: "a snapshot number or ref; empty = the working tree"}
	return []*verbs.Verb{
		{Name: "files.ls", Doc: "List files: the working tree, a snapshot (--at 3, --at main) or the assets zone.", Scope: verbs.Read, Action: authz.StoreRead,
			Args: []verbs.Arg{storeArg, {Name: "prefix", Type: "string", Pos: 2}, zoneArg, atArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading files")
				if err != nil {
					return nil, err
				}
				if at := a.S("at"); at != "" {
					n, err := s.Ref(ctx, at)
					if err != nil {
						return nil, verbs.Errf("not_found", "no snapshot or ref %s", at)
					}
					fs, err := s.SnapshotFiles(ctx, n)
					if err != nil {
						return nil, err
					}
					out := []store.File{}
					for _, f := range fs {
						if strings.HasPrefix(f.Path, a.S("prefix")) {
							out = append(out, f)
						}
					}
					return out, nil
				}
				return s.Files(ctx, zoneOf(a), a.S("prefix"))
			}},
		{Name: "files.cat", Doc: "Read a file as text, base64, json, csv (rows) or lines.", Scope: verbs.Read, Action: authz.StoreRead,
			Args: []verbs.Arg{storeArg, {Name: "path", Type: "string", Pos: 2, Required: true}, zoneArg, atArg,
				{Name: "as", Type: "string", Doc: "text, base64, json, csv or lines (default: text, or base64 for binary)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, _, err := e.open(ctx, p, a.S("store"), rt.LevelView, "reading files")
				if err != nil {
					return nil, err
				}
				var f store.File
				if at := a.S("at"); at != "" {
					n, rerr := s.Ref(ctx, at)
					if rerr != nil {
						return nil, verbs.Errf("not_found", "no snapshot or ref %s", at)
					}
					f, err = s.SnapshotFile(ctx, n, a.S("path"))
				} else {
					f, err = s.File(ctx, zoneOf(a), a.S("path"))
				}
				if errors.Is(err, store.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no file %s", a.S("path"))
				}
				if err != nil {
					return nil, err
				}
				data, err := s.ReadFile(f)
				if err != nil {
					return nil, err
				}
				return decodeAs(f, data, a.S("as"))
			}},
		{Name: "files.put", Doc: "Write one file: text, or data as base64. Tree files show after the next snapshot.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "path", Type: "string", Pos: 2, Required: true}, {Name: "text", Type: "string"},
				{Name: "data", Type: "string", Doc: "base64"}, {Name: "type", Type: "string"}, zoneArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "writing files")
				if err != nil {
					return nil, err
				}
				data := []byte(a.S("text"))
				if a.Has("data") {
					if data, err = base64.StdEncoding.DecodeString(a.S("data")); err != nil {
						return nil, verbs.Errf("invalid_argument", "data must be base64")
					}
				}
				var f store.File
				_, err = s.Do(ctx, who(p, d), func(t *store.Turn) error {
					var err error
					f, err = t.PutFile(zoneOf(a), a.S("path"), data, a.S("type"))
					return err
				})
				if err != nil {
					return nil, fileErr(err)
				}
				return f, nil
			}},
		{Name: "files.rm", Doc: "Delete files under a path (or one file).", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "path", Type: "string", Pos: 2, Required: true}, zoneArg,
				{Name: "recursive", Type: "bool", Doc: "everything under path/"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				s, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "deleting files")
				if err != nil {
					return nil, err
				}
				paths := []string{a.S("path")}
				if a.B("recursive") {
					fs, err := s.Files(ctx, zoneOf(a), strings.TrimSuffix(a.S("path"), "/")+"/")
					if err != nil {
						return nil, err
					}
					for _, f := range fs {
						paths = append(paths, f.Path)
					}
				}
				n := 0
				_, err = s.Do(ctx, who(p, d), func(t *store.Turn) error {
					for _, path := range paths {
						ok, err := t.RemoveFile(zoneOf(a), path)
						if err != nil {
							return err
						}
						if ok {
							n++
						}
					}
					return nil
				})
				return map[string]any{"removed": n}, fileErr(err)
			}},
		{Name: "files.push", Doc: "Replace the tree with a manifest [{path, sha256, size, type?} or {path, text|data}] and snapshot it. Send blobs {sha256: base64} the server lacks; it answers missing_blobs otherwise.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "files", Type: "json", Required: true}, {Name: "blobs", Type: "json"},
				{Name: "message", Type: "string"}, {Name: "ref", Type: "string", Doc: "the ref to move (default main)"},
				{Name: "prune", Type: "bool", Doc: "delete tree files not in the manifest (default true)"},
				{Name: "snapshot", Type: "bool", Doc: "take a snapshot (default true)"}, zoneArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				return push(ctx, e, p, a, true)
			}},
		{Name: "files.blobs", Doc: "Upload blobs {sha256: base64} ahead of a push too large for one request.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "blobs", Type: "json", Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if _, _, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "uploading files"); err != nil {
					return nil, err
				}
				if err := putBlobs(e, a); err != nil {
					return nil, err
				}
				m, _ := argObj(a, "blobs")
				return map[string]any{"stored": len(m)}, nil
			}},
		{Name: "import.files", Doc: "Add files to a zone without pruning or snapshotting (files.push's arguments).", Scope: verbs.Write, Action: authz.StoreAdmin,
			Args: []verbs.Arg{storeArg, {Name: "files", Type: "json", Required: true}, {Name: "blobs", Type: "json"}, zoneArg},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				return push(ctx, e, p, a, false)
			}},
		verbs.Def[SnapNewIn, any]{Name: "snap.new", Doc: "Snapshot the working tree and move a ref (default main) to it.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in SnapNewIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "snapshotting")
				if err != nil {
					return nil, err
				}
				var n int64
				c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
					var err error
					n, err = t.Snapshot(in.Message, in.Ref)
					return err
				})
				if err != nil {
					return nil, fileErr(err)
				}
				return map[string]any{"n": n, "rev": c.Rev}, nil
			}}.Verb(),
		verbs.Def[SnapLsIn, any]{Name: "snap.ls", Doc: "List a store's snapshots, newest first.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in SnapLsIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading snapshots")
				if err != nil {
					return nil, err
				}
				return s.Snapshots(ctx)
			}}.Verb(),
		verbs.Def[RefLsIn, any]{Name: "ref.ls", Doc: "List a store's refs.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in RefLsIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading refs")
				if err != nil {
					return nil, err
				}
				return s.Refs(ctx)
			}}.Verb(),
		verbs.Def[RefMoveIn, any]{Name: "ref.move", Doc: "Point a ref at a snapshot (moving main back is a rollback).", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in RefMoveIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "moving refs")
				if err != nil {
					return nil, err
				}
				c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error { return t.MoveRef(in.Ref, in.N) })
				if err != nil {
					return nil, fileErr(err)
				}
				return map[string]any{"ref": in.Ref, "n": in.N, "rev": c.Rev}, nil
			}}.Verb(),
	}
}

func zoneOf(a verbs.Args) string {
	if z := a.S("zone"); z != "" {
		return z
	}
	return "tree"
}

// decodeAs returns a file's bytes in the requested shape.
func decodeAs(f store.File, data []byte, as string) (any, error) {
	if as == "" {
		as = "text"
		if !utf8.Valid(data) {
			as = "base64"
		}
	}
	switch as {
	case "text":
		return string(data), nil
	case "base64":
		return map[string]any{"path": f.Path, "type": f.Type, "size": f.Size, "sha256": f.SHA256,
			"data": base64.StdEncoding.EncodeToString(data)}, nil
	case "json":
		v := decodeJSON(data)
		if v == nil && strings.TrimSpace(string(data)) != "null" {
			return nil, verbs.Errf("invalid_argument", "%s is not JSON", f.Path)
		}
		return v, nil
	case "lines":
		return strings.Split(strings.TrimRight(string(data), "\n"), "\n"), nil
	case "csv":
		return parseCSV(data)
	}
	return nil, verbs.Errf("invalid_argument", "as must be text, base64, json, csv or lines")
}

// parseCSV reads a CSV with a header row into objects.
func parseCSV(data []byte) ([]map[string]any, error) {
	r := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	r.FieldsPerRecord = -1
	recs, err := r.ReadAll()
	if err != nil {
		return nil, verbs.Errf("invalid_argument", "csv: %s", err.Error())
	}
	out := []map[string]any{}
	if len(recs) == 0 {
		return out, nil
	}
	head := recs[0]
	for _, rec := range recs[1:] {
		m := map[string]any{}
		for i, h := range head {
			if i < len(rec) {
				m[h] = rec[i]
			}
		}
		out = append(out, m)
	}
	return out, nil
}

type pushFile struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Type   string `json:"type,omitempty"`
	Text   string `json:"text,omitempty"` // inline content (eval programs cannot hash)
	Data   string `json:"data,omitempty"` // inline base64 content
}

// push applies a manifest. full=true is files.push (prune and snapshot by
// default); false is import.files (neither).
func push(ctx context.Context, e kernelEnv, p *access.Principal, a verbs.Args, full bool) (any, error) {
	s, d, err := e.open(ctx, p, a.S("store"), rt.LevelAdmin, "pushing files")
	if err != nil {
		return nil, err
	}
	zone := zoneOf(a)
	raw, ok := argList(a, "files")
	if !ok {
		return nil, verbs.Errf("invalid_argument", "files is a list of {path, sha256, size}")
	}
	var files []pushFile
	b, _ := json.Marshal(raw)
	if err := json.Unmarshal(b, &files); err != nil {
		return nil, verbs.Errf("invalid_argument", "files is a list of {path, sha256, size}")
	}
	if len(files) > store.MaxTreeFiles {
		return nil, verbs.Errf("invalid_argument", "at most %d files", store.MaxTreeFiles)
	}
	if err := putBlobs(e, a); err != nil {
		return nil, err
	}
	for i, f := range files {
		if f.Text == "" && f.Data == "" {
			continue
		}
		data := []byte(f.Text)
		if f.Data != "" {
			var err error
			if data, err = base64.StdEncoding.DecodeString(f.Data); err != nil {
				return nil, verbs.Errf("invalid_argument", "%s: data must be base64", f.Path)
			}
		}
		sum, err := s.Blobs.Put(data)
		if err != nil {
			return nil, err
		}
		files[i].SHA256, files[i].Size, files[i].Text, files[i].Data = sum, int64(len(data)), "", ""
	}
	sums := []string{}
	seen := map[string]bool{}
	for _, f := range files {
		if !blobs.ValidSum(f.SHA256) || !store.ValidFilePath(f.Path) {
			return nil, verbs.Errf("invalid_argument", "bad manifest entry %q", f.Path)
		}
		if seen[f.Path] {
			return nil, verbs.Errf("invalid_argument", "%s appears twice", f.Path)
		}
		seen[f.Path] = true
		sums = append(sums, f.SHA256)
	}
	if missing := s.Blobs.Missing(sums); len(missing) > 0 {
		sort.Strings(missing)
		return nil, &verbs.Error{Code: "missing_blobs", Message: "send these blobs", Extra: map[string]any{"missing": missing}}
	}
	prune := full && (!a.Has("prune") || a.B("prune"))
	snap := full && zone == "tree" && (!a.Has("snapshot") || a.B("snapshot"))
	var n int64
	removed := 0
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		for _, f := range files {
			if _, err := t.PutBlob(zone, f.Path, f.SHA256, f.Size, f.Type); err != nil {
				return err
			}
		}
		if prune {
			cur, err := t.ZoneFiles(zone)
			if err != nil {
				return err
			}
			for _, f := range cur {
				if !seen[f.Path] {
					if _, err := t.RemoveFile(zone, f.Path); err != nil {
						return err
					}
					removed++
				}
			}
		}
		if snap {
			var err error
			n, err = t.Snapshot(a.S("message"), a.S("ref"))
			return err
		}
		return nil
	})
	if err != nil {
		return nil, fileErr(err)
	}
	out := map[string]any{"files": len(files), "removed": removed}
	if n > 0 {
		out["n"] = n
	}
	if c != nil {
		out["rev"] = c.Rev
	}
	return out, nil
}

// SnapNewIn is snap.new's input.
type SnapNewIn struct {
	Store   string `json:"store" slop:"pos=1"`
	Message string `json:"message,omitempty" slop:"pos=2"`
	Ref     string `json:"ref,omitempty"`
}

// SnapLsIn is snap.ls's input.
type SnapLsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// RefLsIn is ref.ls's input.
type RefLsIn struct {
	Store string `json:"store" slop:"pos=1"`
}

// RefMoveIn is ref.move's input.
type RefMoveIn struct {
	Store string `json:"store" slop:"pos=1"`
	Ref   string `json:"ref" slop:"pos=2"`
	N     int64  `json:"n" slop:"pos=3"`
}
