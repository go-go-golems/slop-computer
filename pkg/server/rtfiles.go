package server

// The files capability (SLOP3-008 phase 2): a page reads a store's files as
// the viewer, through the contract's files.list and files.read. On claude.ai
// a project is a Claude Code project; here it is a store's main snapshot,
// named by the manifest's files.project:
//
//   - "_stores": every store the viewer may open, at <store>/<path> (the app
//     must also be allowed _stores: capabilities.db.stores and the "stores"
//     policy cell);
//   - an alias of the holder store (any binding): that store, at <path>, at
//     most at the alias's level.
//
// A viewer who cannot read a store gets not_found, as the contract says.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/commands"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

const (
	filesPage    = 500      // entries per list page
	filesMaxRead = 25 << 20 // bytes per read
)

// reachableStores are the stores v's viewer may open, at their level there
// capped by ceil: owned or granted ones (every store for a platform admin).
func (s *Server) reachableStores(ctx context.Context, v *rt.View, ceil rt.Level) ([]system.StoreRow, error) {
	p := s.viewPrincipal(ctx, v)
	var rows []system.StoreRow
	var err error
	if p.IsAdmin() {
		rows, err = s.Sys.Stores(ctx, "")
	} else if p != nil {
		rows, err = commands.VisibleStores(ctx, s.Env, p)
	}
	if err != nil {
		return nil, err
	}
	out := rows[:0]
	for _, r := range rows {
		if min(s.Env.K.Access.Level(ctx, p, r).Level, ceil) >= rt.LevelView {
			out = append(out, r)
		}
	}
	return out, nil
}

// filesStore resolves a project path: the store it is in, the path inside
// its tree, and whether the viewer may read that store. path "" under
// _stores is the top level (the stores themselves).
func (s *Server) filesStore(ctx context.Context, v *rt.View, path string) (string, string, error) {
	path = strings.Trim(path, "/")
	ceil := rt.LevelView
	var storeID, inner string
	if v.Caps.Files == rt.StoresRoot {
		if path == "" {
			return "", "", nil
		}
		storeID, inner, _ = strings.Cut(path, "/")
		ceil = v.Space.Stores
	} else {
		b, err := s.Sys.BindingOf(ctx, v.Target, v.Caps.Files)
		if err != nil {
			return "", "", rtErr("not_found", "no store is bound to %q", v.Caps.Files)
		}
		storeID, inner = b.Target, path
		if l, ok := rt.ParseLevel(b.Level); ok {
			ceil = l
		}
	}
	held := v.Level
	if storeID != v.Target {
		row, err := s.Sys.StoreByID(ctx, storeID)
		if errors.Is(err, system.ErrNotFound) {
			return "", "", rtErr("not_found", "no such file or folder")
		}
		if err != nil {
			return "", "", err
		}
		held = s.Env.K.Access.Level(ctx, s.viewPrincipal(ctx, v), row).Level
	}
	if min(held, ceil) < rt.LevelView {
		return "", "", rtErr("not_found", "no such file or folder") // indistinguishable, as the contract says
	}
	return storeID, inner, nil
}

// treeOf is a store's main snapshot: its files, by path.
func (s *Server) treeOf(ctx context.Context, storeID string) (*store.Store, []store.File, error) {
	st, err := s.Env.K.Store(ctx, storeID)
	if err != nil {
		return nil, nil, rtErr("not_found", "no such file or folder")
	}
	n, err := st.Ref(ctx, "main")
	if err != nil {
		return st, nil, nil // nothing pushed yet: an empty tree
	}
	fs, err := st.SnapshotFiles(ctx, n)
	return st, fs, err
}

type fileEntry struct {
	Path        string `json:"path"`
	IsDirectory bool   `json:"isDirectory"`
	Size        int64  `json:"size"`
}

func (s *Server) rpcFilesList(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Path      string `json:"path"`
		Recursive bool   `json:"recursive"`
		Cursor    string `json:"cursor"`
	}](raw)
	if err != nil {
		return nil, err
	}
	from := 0
	if a.Cursor != "" {
		if from, err = strconv.Atoi(a.Cursor); err != nil || from < 0 {
			return nil, rtErr("bad_request", "that cursor is not one this list returned")
		}
	}
	storeID, inner, err := s.filesStore(ctx, v, a.Path)
	if err != nil {
		return nil, err
	}
	var entries []fileEntry
	if storeID == "" {
		// _stores' top level: the stores the viewer may read, as folders.
		rows, err := s.reachableStores(ctx, v, v.Space.Stores)
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			entries = append(entries, fileEntry{Path: r.ID, IsDirectory: true})
		}
	} else {
		_, fs, err := s.treeOf(ctx, storeID)
		if err != nil {
			return nil, err
		}
		prefix := ""
		if v.Caps.Files == rt.StoresRoot {
			prefix = storeID + "/"
		}
		if entries, err = listTree(fs, inner, a.Recursive, prefix); err != nil {
			return nil, err
		}
	}
	if entries == nil {
		entries = []fileEntry{} // an empty listing is [], not null
	}
	page := map[string]any{}
	if from > len(entries) {
		from = len(entries)
	}
	to := min(from+filesPage, len(entries))
	page["entries"] = entries[from:to]
	if to < len(entries) {
		page["cursor"] = strconv.Itoa(to)
	}
	return page, nil
}

// listTree lists the folder dir of a snapshot's files: its direct children
// (folders synthesized from paths), or everything below it.
func listTree(fs []store.File, dir string, recursive bool, prefix string) ([]fileEntry, error) {
	under := ""
	if dir != "" {
		under = dir + "/"
	}
	dirs := map[string]bool{}
	var out []fileEntry
	found := dir == ""
	for _, f := range fs {
		if f.Path == dir {
			return nil, rtErr("bad_request", "%s is a file: list takes a folder", prefix+dir)
		}
		if !strings.HasPrefix(f.Path, under) {
			continue
		}
		found = true
		rel := f.Path[len(under):]
		parts := strings.Split(rel, "/")
		for i := 1; i < len(parts); i++ {
			d := under + strings.Join(parts[:i], "/")
			if !recursive && i > 1 {
				break
			}
			dirs[d] = true
		}
		if recursive || len(parts) == 1 {
			out = append(out, fileEntry{Path: prefix + f.Path, Size: f.Size})
		}
	}
	if !found {
		return nil, rtErr("not_found", "no such file or folder")
	}
	for d := range dirs {
		out = append(out, fileEntry{Path: prefix + d, IsDirectory: true})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func (s *Server) rpcFilesRead(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Path   string `json:"path"`
		Offset int64  `json:"offset"`
		Length *int64 `json:"length"`
	}](raw)
	if err != nil {
		return nil, err
	}
	length := int64(filesMaxRead)
	if a.Length != nil {
		length = *a.Length
	}
	if a.Offset < 0 || length < 0 || length > filesMaxRead {
		return nil, rtErr("bad_request", "offset and length are bytes, a read at most %d", filesMaxRead)
	}
	storeID, inner, err := s.filesStore(ctx, v, a.Path)
	if err != nil {
		return nil, err
	}
	if storeID == "" || inner == "" {
		return nil, rtErr("bad_request", "read takes a file, not a folder")
	}
	st, fs, err := s.treeOf(ctx, storeID)
	if err != nil {
		return nil, err
	}
	for _, f := range fs {
		if f.Path == inner {
			b, err := st.ReadFile(f)
			if err != nil {
				return nil, err
			}
			if a.Offset > int64(len(b)) {
				return nil, rtErr("bad_request", "offset %d is past the end (%d bytes)", a.Offset, len(b))
			}
			end := min(a.Offset+length, int64(len(b)))
			return map[string]any{"bytes": base64.StdEncoding.EncodeToString(b[a.Offset:end]), "size": f.Size, "revision": f.SHA256}, nil
		}
		if strings.HasPrefix(f.Path, inner+"/") {
			return nil, rtErr("bad_request", "read takes a file, not a folder")
		}
	}
	return nil, rtErr("not_found", "no such file or folder")
}
