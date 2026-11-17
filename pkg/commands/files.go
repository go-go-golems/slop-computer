package commands

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/invopop/jsonschema"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func filesVerbs(e filesEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[FilesLsIn, []store.File]{Name: "files.ls", Doc: "List files: the working tree, a snapshot (--at 3, --at main) or the assets zone.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in FilesLsIn) ([]store.File, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading files")
				if err != nil {
					return nil, err
				}
				if at := in.At; at != "" {
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
						if strings.HasPrefix(f.Path, in.Prefix) {
							out = append(out, f)
						}
					}
					return out, nil
				}
				return s.Files(ctx, zoneOf(in.Zone), in.Prefix)
			}}.Verb(),
		verbs.Def[FilesCatIn, any]{Name: "files.cat", Doc: "Read a file as text, base64, json, csv (rows) or lines.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in FilesCatIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading files")
				if err != nil {
					return nil, err
				}
				var f store.File
				if at := in.At; at != "" {
					n, rerr := s.Ref(ctx, at)
					if rerr != nil {
						return nil, verbs.Errf("not_found", "no snapshot or ref %s", at)
					}
					f, err = s.SnapshotFile(ctx, n, in.Path)
				} else {
					f, err = s.File(ctx, zoneOf(in.Zone), in.Path)
				}
				if errors.Is(err, store.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no file %s", in.Path)
				}
				if err != nil {
					return nil, err
				}
				data, err := s.ReadFile(f)
				if err != nil {
					return nil, err
				}
				return decodeAs(f, data, in.As)
			}}.Verb(),
		verbs.Def[FilesPutIn, store.File]{Name: "files.put", Doc: "Write one file: text, or data as base64. Tree files show after the next snapshot.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in FilesPutIn) (store.File, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "writing files")
				if err != nil {
					return store.File{}, err
				}
				data := []byte(in.Text)
				if in.Data != nil {
					if data, err = base64.StdEncoding.DecodeString(*in.Data); err != nil {
						return store.File{}, verbs.Errf("invalid_argument", "data must be base64")
					}
				}
				var f store.File
				_, err = s.Do(ctx, who(p, d), func(t *store.Turn) error {
					var err error
					f, err = t.PutFile(zoneOf(in.Zone), in.Path, data, in.Type)
					return err
				})
				if err != nil {
					return store.File{}, fileErr(err)
				}
				return f, nil
			}}.Verb(),
		verbs.Def[FilesRmIn, FilesRmOut]{Name: "files.rm", Doc: "Delete files under a path (or one file).", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in FilesRmIn) (FilesRmOut, error) {
				ctx := req.Context
				p := req.Principal
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "deleting files")
				if err != nil {
					return FilesRmOut{}, err
				}
				paths := []string{in.Path}
				if in.Recursive {
					fs, err := s.Files(ctx, zoneOf(in.Zone), strings.TrimSuffix(in.Path, "/")+"/")
					if err != nil {
						return FilesRmOut{}, err
					}
					for _, f := range fs {
						paths = append(paths, f.Path)
					}
				}
				n := 0
				_, err = s.Do(ctx, who(p, d), func(t *store.Turn) error {
					for _, path := range paths {
						ok, err := t.RemoveFile(zoneOf(in.Zone), path)
						if err != nil {
							return err
						}
						if ok {
							n++
						}
					}
					return nil
				})
				return FilesRmOut{Removed: n}, fileErr(err)
			}}.Verb(),
		verbs.Def[FilesPushIn, FilesPushOut]{Name: "files.push", Doc: "Replace the tree of a ref (default main) with a manifest [{path, sha256, size, type?} or {path, text|data}] and snapshot it; files not listed are deleted. ifAt is required: the snapshot the ref points at now (0: it does not exist yet); when it moved, the answer is conflict (extra.at) and nothing is written. Send blobs {sha256: base64} the server lacks; it answers missing_blobs (extra.missing) otherwise. activate: instances to bring up on the new snapshot.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in FilesPushIn) (FilesPushOut, error) {
				return e.push(req.Context, req.Principal, in)
			}}.Verb(),
		verbs.Def[FilesCommitIn, FilesCommitOut]{Name: "files.commit", Doc: "Commit changes [{path, text} | {path, data} (base64) | {path, sha256, size, type?} | {path, delete: true}] to a ref (default main) as a new snapshot; files not listed stay as they are. base is required: the snapshot the changes start from (0: the ref does not exist yet). When the ref moved since base, the changes apply over where it is now, unless a changed path was also changed there to a different result: then the answer is conflict (extra.at, extra.conflicts [{path}]) and nothing is written; so is a ref removed since base. An unchanged tree keeps the ref's snapshot. Blobs the server lacks: missing_blobs (extra.missing); send them as blobs {sha256: base64}. activate: instances to bring up on the new snapshot.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in FilesCommitIn) (FilesCommitOut, error) {
				return e.commit(req.Context, req.Principal, in)
			}}.Verb(),
		verbs.Def[FilesBlobsIn, FilesBlobsOut]{Name: "files.blobs", Doc: "Upload blobs {sha256: base64} ahead of a push or commit too large for one request.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in FilesBlobsIn) (FilesBlobsOut, error) {
				ctx := req.Context
				p := req.Principal
				if _, _, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "uploading files"); err != nil {
					return FilesBlobsOut{}, err
				}
				if err := putBlobs(e.kernelEnv, in.Blobs); err != nil {
					return FilesBlobsOut{}, err
				}
				m, _ := objOf(in.Blobs)
				return FilesBlobsOut{Stored: len(m)}, nil
			}}.Verb(),
		verbs.Def[ImportFilesIn, ImportFilesOut]{Name: "import.files", Doc: "Add files to a zone (tree or assets) from a manifest like files.push's, without deleting others or taking a snapshot.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in ImportFilesIn) (ImportFilesOut, error) {
				return e.importFiles(req.Context, req.Principal, in)
			}}.Verb(),
		verbs.Def[SnapLsIn, []store.Snapshot]{Name: "snap.ls", Doc: "List a store's snapshots, newest first.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in SnapLsIn) ([]store.Snapshot, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading snapshots")
				if err != nil {
					return nil, err
				}
				return s.Snapshots(ctx)
			}}.Verb(),
		verbs.Def[RefLsIn, map[string]int64]{Name: "ref.ls", Doc: "List a store's refs.", Scope: verbs.Read, Action: authz.StoreRead,
			Run: func(req verbs.Req, in RefLsIn) (map[string]int64, error) {
				ctx := req.Context
				p := req.Principal
				s, _, err := e.open(ctx, p, in.Store, rt.LevelView, "reading refs")
				if err != nil {
					return nil, err
				}
				return s.Refs(ctx)
			}}.Verb(),
		verbs.Def[RefMoveIn, RefMoveOut]{Name: "ref.move", Doc: "Point a ref at snapshot n (moving main back is a rollback), creating it if needed. ifAt is required: the snapshot the ref points at now (0: it does not exist yet); when it moved, the answer is conflict (extra.at) and nothing moves, so two publishers cannot overwrite each other. Ref names are lowercase and start with a letter (main, draft, proposal/x1).", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in RefMoveIn) (RefMoveOut, error) {
				ctx := req.Context
				p := req.Principal
				if in.IfAt == nil {
					return RefMoveOut{}, verbs.Errf("invalid_argument", "ref.move needs ifAt: the snapshot %s points at now (0: it does not exist yet)", in.Ref)
				}
				ref := in.Ref
				if !store.ValidRefName(ref) {
					return RefMoveOut{}, badRef(ref)
				}
				s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "moving refs")
				if err != nil {
					return RefMoveOut{}, err
				}
				c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
					if err := refIsAt(t, ref, *in.IfAt); err != nil {
						return err
					}
					return t.MoveRef(ref, in.N)
				})
				if err != nil {
					return RefMoveOut{}, fileErr(err)
				}
				out := RefMoveOut{Ref: ref, N: in.N, From: *in.IfAt}
				if c != nil {
					out.Rev = c.Rev
				}
				return out, nil
			}}.Verb(),
		verbs.Def[RefRmIn, RefRmOut]{Name: "ref.rm", Doc: "Remove a ref (its snapshots stay). ifAt is required: the snapshot the ref points at now; when it moved, the answer is conflict (extra.at) and nothing is removed. main is not removed (remove the store), nor a ref that a store follows (app.follow): conflict, naming them in extra.stores.", Scope: verbs.Write, Action: authz.StoreAdmin,
			Run: func(req verbs.Req, in RefRmIn) (RefRmOut, error) {
				return e.removeRef(req.Context, req.Principal, in)
			}}.Verb(),
	}
}

func zoneOf(zone string) string {
	if zone != "" {
		return zone
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

// manifestFile is one entry of a files.push or import.files manifest.
type manifestFile struct {
	Path   string  `json:"path"`
	SHA256 string  `json:"sha256"`
	Size   int64   `json:"size"`
	Type   string  `json:"type,omitempty"`
	Text   *string `json:"text,omitempty"` // inline content (eval programs cannot hash); "" is an empty file
	Data   string  `json:"data,omitempty"` // inline base64 content
}

// readManifest decodes a manifest for store s: it stores the call's blobs
// and each entry's inline content, and checks that every entry names a
// clean path once and a blob the server has (missing_blobs, with the list
// in extra.missing, otherwise).
func readManifest(e kernelEnv, s *store.Store, filesArg, blobsArg any) ([]manifestFile, error) {
	raw, ok := listOf(filesArg)
	if !ok {
		return nil, verbs.Errf("invalid_argument", "files is a list of {path, sha256, size}")
	}
	var files []manifestFile
	b, _ := json.Marshal(raw)
	if err := json.Unmarshal(b, &files); err != nil {
		return nil, verbs.Errf("invalid_argument", "files is a list of {path, sha256, size}")
	}
	if len(files) > store.MaxTreeFiles {
		return nil, verbs.Errf("invalid_argument", "at most %d files", store.MaxTreeFiles)
	}
	if err := putBlobs(e, blobsArg); err != nil {
		return nil, err
	}
	for i, f := range files {
		if f.Text == nil && f.Data == "" {
			continue
		}
		var data []byte
		if f.Text != nil {
			data = []byte(*f.Text)
		}
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
		files[i].SHA256, files[i].Size, files[i].Text, files[i].Data = sum, int64(len(data)), nil, ""
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
	if err := missingBlobs(s, sums); err != nil {
		return nil, err
	}
	return files, nil
}

// missingBlobs is the missing_blobs error for the sums the server lacks,
// listed in extra.missing (the CLI uploads them with files.blobs and
// retries), or nil.
func missingBlobs(s *store.Store, sums []string) error {
	missing := s.Blobs.Missing(sums)
	if len(missing) == 0 {
		return nil
	}
	sort.Strings(missing)
	return &verbs.Error{Code: "missing_blobs", Message: "send these blobs", Extra: map[string]any{"missing": missing}}
}

// refArg is an optional ref argument: main when empty, otherwise a
// ValidRefName.
func refArg(ref string) (string, error) {
	if ref == "" {
		return "main", nil
	}
	if !store.ValidRefName(ref) {
		return "", badRef(ref)
	}
	return ref, nil
}

func badRef(ref string) error {
	return verbs.Errf("invalid_argument", "%q is not a ref name (lowercase, starting with a letter: main, draft, proposal/x1)", ref)
}

// refIsAt is the precondition of a ref write, checked in the write's own
// turn so nothing moves the ref in between: ref points at ifAt (0: it does
// not exist), or the answer is conflict with extra.at.
func refIsAt(t *store.Turn, ref string, ifAt int64) error {
	at, err := t.RefAt(ref)
	if err != nil {
		return err
	}
	if at != ifAt {
		return &verbs.Error{Code: "conflict", Message: fmt.Sprintf("%s points at %d, not %d: it moved since you looked", ref, at, ifAt),
			Extra: map[string]any{"at": at}}
	}
	return nil
}

// push is files.push: the tree becomes the manifest, snapshotted onto the
// ref, if the ref is still at ifAt.
func (e filesEnv) push(ctx context.Context, p *access.Principal, in FilesPushIn) (FilesPushOut, error) {
	if in.IfAt == nil {
		return FilesPushOut{}, verbs.Errf("invalid_argument", "files.push needs ifAt: the snapshot the ref points at now (0: it does not exist yet)")
	}
	ref, err := refArg(in.Ref)
	if err != nil {
		return FilesPushOut{}, err
	}
	s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "pushing files")
	if err != nil {
		return FilesPushOut{}, err
	}
	files, err := readManifest(e.kernelEnv, s, in.Files, in.Blobs)
	if err != nil {
		return FilesPushOut{}, err
	}
	out := FilesPushOut{Files: len(files)}
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		if err := refIsAt(t, ref, *in.IfAt); err != nil {
			return err
		}
		listed := make(map[string]bool, len(files))
		for _, f := range files {
			listed[f.Path] = true
			if _, err := t.PutBlob("tree", f.Path, f.SHA256, f.Size, f.Type); err != nil {
				return err
			}
		}
		cur, err := t.TreeFiles()
		if err != nil {
			return err
		}
		for _, f := range cur {
			if !listed[f.Path] {
				if _, err := t.RemoveFile("tree", f.Path); err != nil {
					return err
				}
				out.Removed++
			}
		}
		out.N, err = t.Snapshot(in.Message, ref)
		return err
	})
	if err != nil {
		return FilesPushOut{}, fileErr(err)
	}
	if c != nil {
		out.Rev = c.Rev
	}
	out.Activated = e.activate(ctx, p, in.Activate)
	return out, nil
}

// importFiles is import.files: the manifest's files are added to a zone;
// nothing is deleted and no snapshot is taken.
func (e filesEnv) importFiles(ctx context.Context, p *access.Principal, in ImportFilesIn) (ImportFilesOut, error) {
	s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "importing files")
	if err != nil {
		return ImportFilesOut{}, err
	}
	files, err := readManifest(e.kernelEnv, s, in.Files, in.Blobs)
	if err != nil {
		return ImportFilesOut{}, err
	}
	zone := zoneOf(in.Zone)
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		for _, f := range files {
			if _, err := t.PutBlob(zone, f.Path, f.SHA256, f.Size, f.Type); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return ImportFilesOut{}, fileErr(err)
	}
	out := ImportFilesOut{Files: len(files)}
	if c != nil {
		out.Rev = c.Rev
	}
	return out, nil
}

// fileChange is a FileChange with its content in the blob store.
type fileChange struct {
	Path, SHA256, Type string
	Size               int64
	Delete             bool
}

// readChanges checks files.commit's changes (a clean path, once each, and
// exactly one of text, data, sha256 or delete), stores inline contents as
// blobs, and answers missing_blobs for sha256 entries the server lacks.
func readChanges(s *store.Store, in []FileChange) ([]fileChange, error) {
	if len(in) > store.MaxTreeFiles {
		return nil, verbs.Errf("invalid_argument", "at most %d changes", store.MaxTreeFiles)
	}
	out := make([]fileChange, 0, len(in))
	seen := make(map[string]bool, len(in))
	sums := []string{}
	for _, c := range in {
		if !store.ValidFilePath(c.Path) {
			return nil, verbs.Errf("invalid_argument", "bad path %q", c.Path)
		}
		if seen[c.Path] {
			return nil, verbs.Errf("invalid_argument", "%s appears twice", c.Path)
		}
		seen[c.Path] = true
		given := 0
		for _, g := range []bool{c.Text != nil, c.Data != nil, c.SHA256 != "", c.Delete} {
			if g {
				given++
			}
		}
		if given != 1 {
			return nil, verbs.Errf("invalid_argument", "%s: give exactly one of text, data, sha256 or delete", c.Path)
		}
		f := fileChange{Path: c.Path, Type: c.Type, Delete: c.Delete}
		switch {
		case c.SHA256 != "":
			if !blobs.ValidSum(c.SHA256) {
				return nil, verbs.Errf("invalid_argument", "%s: sha256 %q is not a sha256", c.Path, c.SHA256)
			}
			f.SHA256, f.Size = c.SHA256, c.Size
			sums = append(sums, c.SHA256)
		case c.Text != nil || c.Data != nil:
			var data []byte
			if c.Text != nil {
				data = []byte(*c.Text)
			} else {
				var err error
				if data, err = base64.StdEncoding.DecodeString(*c.Data); err != nil {
					return nil, verbs.Errf("invalid_argument", "%s: data must be base64", c.Path)
				}
			}
			if len(data) > store.MaxTreeFile {
				return nil, verbs.Errf("invalid_argument", "file %s is too large", c.Path)
			}
			sum, err := s.Blobs.Put(data)
			if err != nil {
				return nil, err
			}
			f.SHA256, f.Size = sum, int64(len(data))
		}
		out = append(out, f)
	}
	if err := missingBlobs(s, sums); err != nil {
		return nil, err
	}
	return out, nil
}

// commit is files.commit. In one turn: where the ref is now (at); when it
// moved since base, a per-path check that nothing changed there conflicts
// with this commit; then the tree becomes snapshot at, the changes are
// applied, and the tree is snapshotted onto the ref.
func (e filesEnv) commit(ctx context.Context, p *access.Principal, in FilesCommitIn) (FilesCommitOut, error) {
	if in.Base == nil || *in.Base < 0 {
		return FilesCommitOut{}, verbs.Errf("invalid_argument", "files.commit needs base: the snapshot the changes start from (0: the ref does not exist yet)")
	}
	base := *in.Base
	ref, err := refArg(in.Ref)
	if err != nil {
		return FilesCommitOut{}, err
	}
	s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "committing files")
	if err != nil {
		return FilesCommitOut{}, err
	}
	if err := putBlobs(e.kernelEnv, in.Blobs); err != nil {
		return FilesCommitOut{}, err
	}
	changes, err := readChanges(s, in.Changes)
	if err != nil {
		return FilesCommitOut{}, err
	}
	out := FilesCommitOut{Base: base}
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		at, err := t.RefAt(ref)
		if err != nil {
			return err
		}
		if base > 0 {
			if ok, err := t.HasSnapshot(base); err != nil {
				return err
			} else if !ok {
				return verbs.Errf("invalid_argument", "base %d is not a snapshot of %s", base, in.Store)
			}
		}
		if at == 0 && base > 0 {
			// removed since base: recreating it from these changes alone
			// is never what the committer meant
			return &verbs.Error{Code: "conflict", Message: fmt.Sprintf("%s was removed since %d", ref, base),
				Extra: map[string]any{"at": int64(0), "conflicts": []CommitConflict{}}}
		}
		if at != base {
			conflicts, err := commitConflicts(t, base, at, changes)
			if err != nil {
				return err
			}
			if len(conflicts) > 0 {
				paths := make([]string, len(conflicts))
				for i, c := range conflicts {
					paths[i] = c.Path
				}
				return &verbs.Error{Code: "conflict",
					Message: fmt.Sprintf("%s moved from %d to %d, which also changed %s", ref, base, at, strings.Join(paths, ", ")),
					Extra:   map[string]any{"at": at, "conflicts": conflicts}}
			}
		}
		if err := t.ResetTree(at); err != nil {
			return err
		}
		for _, c := range changes {
			if c.Delete {
				if _, err := t.RemoveFile("tree", c.Path); err != nil {
					return err
				}
				continue
			}
			if _, err := t.PutBlob("tree", c.Path, c.SHA256, c.Size, c.Type); err != nil {
				return err
			}
		}
		out.At, out.Merged = at, at != base
		out.N, err = t.Snapshot(in.Message, ref)
		return err
	})
	if err != nil {
		return FilesCommitOut{}, fileErr(err)
	}
	if c != nil {
		out.Rev = c.Rev
	}
	out.Activated = e.activate(ctx, p, in.Activate)
	return out, nil
}

// commitConflicts are the changes whose path changed between base and at
// (added, removed or given other bytes) to something other than what the
// change makes it: a change that agrees with theirs is no conflict.
func commitConflicts(t *store.Turn, base, at int64, changes []fileChange) ([]CommitConflict, error) {
	byPath := func(n int64) (map[string]string, error) {
		fs, err := t.SnapshotFiles(n)
		m := make(map[string]string, len(fs))
		for _, f := range fs {
			m[f.Path] = f.SHA256
		}
		return m, err
	}
	was, err := byPath(base)
	if err != nil {
		return nil, err
	}
	now, err := byPath(at)
	if err != nil {
		return nil, err
	}
	out := []CommitConflict{}
	for _, c := range changes {
		before, inBase := was[c.Path]
		after, inAt := now[c.Path]
		if inBase == inAt && before == after {
			continue // untouched since base
		}
		if (c.Delete && !inAt) || (!c.Delete && inAt && after == c.SHA256) {
			continue // they made the same change
		}
		out = append(out, CommitConflict{Path: c.Path})
	}
	return out, nil
}

// activate brings each store up on the snapshot the ref it follows points
// at now, and reports it (SLOP3-022 C.2): the dev loop learns at once that
// a migration failed, while the instance keeps serving its last good
// version. A store that cannot be read or activated reports why in error.
func (e filesEnv) activate(ctx context.Context, p *access.Principal, ids []string) []Activated {
	if len(ids) == 0 {
		return nil
	}
	out := make([]Activated, 0, len(ids))
	for _, id := range ids {
		st, _, err := e.open(ctx, p, id, rt.LevelView, "reading")
		if err != nil {
			out = append(out, Activated{Store: id, Error: err.Error()})
			continue
		}
		s, err := statusOf(ctx, e.kernelEnv, e.A, st, id, false)
		if err != nil {
			out = append(out, Activated{Store: id, Error: err.Error()})
			continue
		}
		out = append(out, Activated{Store: s.Store, App: s.App, Ref: s.Ref, N: s.N, Broken: s.Broken})
	}
	return out
}

// removeRef is ref.rm.
func (e filesEnv) removeRef(ctx context.Context, p *access.Principal, in RefRmIn) (RefRmOut, error) {
	if in.IfAt == nil {
		return RefRmOut{}, verbs.Errf("invalid_argument", "ref.rm needs ifAt: the snapshot %s points at now", in.Ref)
	}
	if in.Ref == "main" {
		return RefRmOut{}, verbs.Errf("invalid_argument", "main is removed by removing the store")
	}
	s, d, err := e.open(ctx, p, in.Store, rt.LevelAdmin, "removing refs")
	if err != nil {
		return RefRmOut{}, err
	}
	followers, err := e.following(ctx, s.ID, in.Ref)
	if err != nil {
		return RefRmOut{}, err
	}
	if len(followers) > 0 {
		return RefRmOut{}, &verbs.Error{Code: "conflict", Message: fmt.Sprintf("%s follows %s@%s: make it follow another ref first (app.follow)", strings.Join(followers, ", "), s.ID, in.Ref),
			Extra: map[string]any{"stores": followers}}
	}
	out := RefRmOut{Ref: in.Ref}
	c, err := s.Do(ctx, who(p, d), func(t *store.Turn) error {
		at, err := t.RefAt(in.Ref)
		if err != nil {
			return err
		}
		if at == 0 {
			return verbs.Errf("not_found", "%s has no ref %s", s.ID, in.Ref)
		}
		if err := refIsAt(t, in.Ref, *in.IfAt); err != nil {
			return err
		}
		out.N = at
		_, err = t.RemoveRef(in.Ref)
		return err
	})
	if err != nil {
		return RefRmOut{}, fileErr(err)
	}
	if c != nil {
		out.Rev = c.Rev
	}
	return out, nil
}

// following lists the stores that run app at ref (app.follow), the app
// store itself included. It reads every store's registry row and the meta
// of app's instances, outside any turn: a store that starts following ref
// meanwhile is not seen (it then runs nothing until it follows another).
func (e filesEnv) following(ctx context.Context, app, ref string) ([]string, error) {
	rows, err := e.K.Registry.Stores(ctx, "")
	if err != nil {
		return nil, err
	}
	out := []string{}
	for _, r := range rows {
		if r.ID != app && r.App != app {
			continue
		}
		if r.ID == app && r.App != "" && r.App != app {
			continue // the store runs another app's code
		}
		st, err := e.K.Store(ctx, r.ID)
		if err != nil {
			return nil, err
		}
		if st.Meta("app_ref") == ref {
			out = append(out, r.ID)
		}
	}
	sort.Strings(out)
	return out, nil
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
	IfAt  *int64 `json:"ifAt" jsonschema_description:"required: the snapshot the ref points at now (0: it does not exist yet); otherwise conflict, nothing moves"`
}

// RefRmIn is ref.rm's input.
type RefRmIn struct {
	Store string `json:"store" slop:"pos=1"`
	Ref   string `json:"ref" slop:"pos=2"`
	IfAt  *int64 `json:"ifAt" jsonschema_description:"required: the snapshot the ref points at now; otherwise conflict, nothing removed"`
}

// FilesLsIn is files.ls's input.
type FilesLsIn struct {
	Store  string `json:"store" slop:"pos=1"`
	Prefix string `json:"prefix,omitempty" slop:"pos=2"`
	Zone   string `json:"zone,omitempty" jsonschema_description:"tree (default) or assets"`
	At     string `json:"at,omitempty" jsonschema_description:"a snapshot number or ref; empty = the working tree"`
}

// FilesCatIn is files.cat's input.
type FilesCatIn struct {
	Store string `json:"store" slop:"pos=1"`
	Path  string `json:"path" slop:"pos=2"`
	Zone  string `json:"zone,omitempty" jsonschema_description:"tree (default) or assets"`
	At    string `json:"at,omitempty" jsonschema_description:"a snapshot number or ref; empty = the working tree"`
	As    string `json:"as,omitempty" jsonschema_description:"text, base64, json, csv or lines (default: text, or base64 for binary)"`
}

// FilesPutIn is files.put's input.
type FilesPutIn struct {
	Store string  `json:"store" slop:"pos=1"`
	Path  string  `json:"path" slop:"pos=2"`
	Text  string  `json:"text,omitempty"`
	Data  *string `json:"data,omitempty" jsonschema_description:"base64"`
	Type  string  `json:"type,omitempty"`
	Zone  string  `json:"zone,omitempty" jsonschema_description:"tree (default) or assets"`
}

// FilesRmIn is files.rm's input.
type FilesRmIn struct {
	Store     string `json:"store" slop:"pos=1"`
	Path      string `json:"path" slop:"pos=2"`
	Zone      string `json:"zone,omitempty" jsonschema_description:"tree (default) or assets"`
	Recursive bool   `json:"recursive,omitempty" jsonschema_description:"everything under path/"`
}

// FilesPushIn is files.push's input.
type FilesPushIn struct {
	Store    string   `json:"store" slop:"pos=1"`
	Files    any      `json:"files" jsonschema_description:"the whole tree: [{path, sha256, size, type?} or {path, text} or {path, data (base64)}]"`
	Blobs    any      `json:"blobs,omitempty" jsonschema_description:"{sha256: base64} for blobs the server lacks"`
	Message  string   `json:"message,omitempty"`
	Ref      string   `json:"ref,omitempty" jsonschema_description:"the ref to move (default main)"`
	IfAt     *int64   `json:"ifAt" jsonschema_description:"required: the snapshot the ref points at now (0: it does not exist yet); otherwise conflict, nothing written"`
	Activate []string `json:"activate,omitempty" jsonschema_description:"stores to activate after the snapshot (the instances following the moved ref); the result reports each one's n and broken"`
}

// FilesCommitIn is files.commit's input.
type FilesCommitIn struct {
	Store    string       `json:"store" slop:"pos=1"`
	Ref      string       `json:"ref,omitempty" jsonschema_description:"the ref to commit to (default main)"`
	Base     *int64       `json:"base" jsonschema_description:"required: the snapshot the changes start from (0: the ref does not exist yet)"`
	Message  string       `json:"message,omitempty"`
	Changes  []FileChange `json:"changes"`
	Blobs    any          `json:"blobs,omitempty" jsonschema_description:"{sha256: base64} for blobs the server lacks"`
	Activate []string     `json:"activate,omitempty" jsonschema_description:"stores to activate after the snapshot (the instances following the ref); the result reports each one's n and broken"`
}

// FileChange is one change of files.commit: exactly one of text, data,
// sha256 or delete. A path not in the list is unchanged.
type FileChange struct {
	Path   string  `json:"path"`
	Text   *string `json:"text,omitempty" jsonschema_description:"the file's text (an empty string is an empty file)"`
	Data   *string `json:"data,omitempty" jsonschema_description:"the file's bytes, base64"`
	SHA256 string  `json:"sha256,omitempty" jsonschema_description:"a blob the server holds, with its size"`
	Size   int64   `json:"size,omitempty"`
	Type   string  `json:"type,omitempty" jsonschema_description:"the content type (default: from the path)"`
	Delete bool    `json:"delete,omitempty" jsonschema_description:"remove the file (nothing to do if it does not exist)"`
}

// JSONSchemaExtend declares files as what push accepts (pushFilesSchema).
func (FilesPushIn) JSONSchemaExtend(s *jsonschema.Schema) { setPushFiles(s) }

// JSONSchemaExtend declares files as what push accepts (pushFilesSchema).
func (ImportFilesIn) JSONSchemaExtend(s *jsonschema.Schema) { setPushFiles(s) }

func setPushFiles(s *jsonschema.Schema) {
	if s.Properties != nil {
		s.Properties.Set("files", pushFilesSchema())
	}
}

// pushFilesSchema is a push manifest's schema: a list whose entries each
// give their content one way (text, base64 data, or a blob named by
// sha256 and size), or that list as JSON text, as the CLI passes it. The
// TypeScript generated from it is a union, so code that writes an entry
// of one kind with another kind's fields does not compile (SLOP3-024).
func pushFilesSchema() *jsonschema.Schema {
	return &jsonschema.Schema{Description: "the files the tree holds after the push", OneOf: []*jsonschema.Schema{
		{Type: "array", Items: &jsonschema.Schema{OneOf: []*jsonschema.Schema{
			fileEntry("inline text", "text", &jsonschema.Schema{Type: "string"}),
			fileEntry("inline bytes", "data", &jsonschema.Schema{Type: "string", Description: "base64"}),
			fileEntry("a blob the server has (or that blobs carries)", "sha256", &jsonschema.Schema{Type: "string"}, "size", &jsonschema.Schema{Type: "integer"}),
		}}},
		{Type: "string", Description: "the list as JSON text"},
	}}
}

// fileEntry is one kind of manifest entry or change: path, the fields
// kv names (all required), and an optional type.
func fileEntry(doc string, kv ...any) *jsonschema.Schema {
	e := &jsonschema.Schema{Type: "object", Description: doc, Properties: jsonschema.NewProperties(), AdditionalProperties: jsonschema.FalseSchema}
	e.Properties.Set("path", &jsonschema.Schema{Type: "string", Description: "the file's path in the tree"})
	e.Required = []string{"path"}
	for i := 0; i < len(kv); i += 2 {
		e.Properties.Set(kv[i].(string), kv[i+1].(*jsonschema.Schema))
		e.Required = append(e.Required, kv[i].(string))
	}
	if kv[0] != "delete" {
		e.Properties.Set("type", &jsonschema.Schema{Type: "string", Description: "its media type (default: from the extension)"})
	}
	return e
}

// JSONSchema declares a change as the union files.commit enforces (exactly
// one of text, data, sha256 or delete), so its TypeScript is a union too:
// a change built from one kind's fields with another kind's does not
// compile (SLOP3-024; the bug the review of #51 found).
func (FileChange) JSONSchema() *jsonschema.Schema {
	return &jsonschema.Schema{OneOf: []*jsonschema.Schema{
		fileEntry("the file's text (an empty string is an empty file)", "text", &jsonschema.Schema{Type: "string"}),
		fileEntry("the file's bytes", "data", &jsonschema.Schema{Type: "string", Description: "base64"}),
		fileEntry("a blob the server holds", "sha256", &jsonschema.Schema{Type: "string"}, "size", &jsonschema.Schema{Type: "integer"}),
		fileEntry("remove the file (nothing to do if it does not exist)", "delete", &jsonschema.Schema{Const: true}),
	}}
}

// FilesBlobsIn is files.blobs's input.
type FilesBlobsIn struct {
	Store string `json:"store" slop:"pos=1"`
	Blobs any    `json:"blobs"`
}

// ImportFilesIn is import.files's input.
type ImportFilesIn struct {
	Store string `json:"store" slop:"pos=1"`
	Files any    `json:"files"`
	Blobs any    `json:"blobs,omitempty"`
	Zone  string `json:"zone,omitempty" jsonschema_description:"tree (default) or assets"`
}

// FilesRmOut is files.rm's result.
type FilesRmOut struct {
	Removed int `json:"removed"`
}

// FilesBlobsOut is files.blobs's result.
type FilesBlobsOut struct {
	Stored int `json:"stored"`
}

// RefMoveOut is ref.move's result.
type RefMoveOut struct {
	N    int64  `json:"n"`
	From int64  `json:"from"` // where the ref pointed before (0: it did not exist)
	Ref  string `json:"ref"`
	Rev  int64  `json:"rev"`
}

// RefRmOut is ref.rm's result.
type RefRmOut struct {
	Ref string `json:"ref"`
	N   int64  `json:"n"` // where the ref pointed
	Rev int64  `json:"rev"`
}

// FilesPushOut is files.push's result.
type FilesPushOut struct {
	N         int64       `json:"n"`             // the snapshot the ref points at now (an unchanged tree keeps the ref's)
	Files     int         `json:"files"`         // entries in the manifest
	Removed   int         `json:"removed"`       // tree files deleted because the manifest does not list them
	Rev       int64       `json:"rev,omitempty"` // the store's rev of this write; none when nothing changed
	Activated []Activated `json:"activated,omitempty"`
}

// FilesCommitOut is files.commit's result.
type FilesCommitOut struct {
	N         int64       `json:"n"`             // the snapshot the ref points at now (a commit that changes nothing keeps at)
	At        int64       `json:"at"`            // where the ref pointed when the commit applied (0: it did not exist)
	Base      int64       `json:"base"`          // the base the commit was made from
	Merged    bool        `json:"merged"`        // at != base: the changes were applied over newer snapshots
	Rev       int64       `json:"rev,omitempty"` // the store's rev of this write; none when nothing changed
	Activated []Activated `json:"activated,omitempty"`
}

// CommitConflict is a path a files.commit changed that the ref's newer
// snapshot also changed, to something else.
type CommitConflict struct {
	Path string `json:"path"`
}

// Activated is one store a push or commit asked to activate: where it runs
// now (n, and why it stayed on an older version: broken), or why it could
// not be read (error; the other fields are then empty).
type Activated struct {
	Store  string `json:"store"`
	App    string `json:"app,omitempty"`
	Ref    string `json:"ref,omitempty"`
	N      int64  `json:"n"`
	Broken string `json:"broken"`
	Error  string `json:"error,omitempty"`
}

// ImportFilesOut is import.files's result.
type ImportFilesOut struct {
	Files int   `json:"files"`
	Rev   int64 `json:"rev,omitempty"`
}
