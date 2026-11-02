package client

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// FileEntry is one file of a push manifest or an export.
type FileEntry struct {
	Zone   string `json:"zone,omitempty"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
	Type   string `json:"type,omitempty"`
}

// ReadDir reads a folder into a manifest and its blobs. Dot files and
// directories (.git, .DS_Store) are skipped.
func ReadDir(dir string) ([]FileEntry, map[string][]byte, error) {
	files := []FileEntry{}
	data := map[string][]byte{}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if p != dir && strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		sum := sha256.Sum256(b)
		h := hex.EncodeToString(sum[:])
		files = append(files, FileEntry{Path: filepath.ToSlash(rel), SHA256: h, Size: int64(len(b))})
		data[h] = b
		return nil
	})
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, data, err
}

// blobChunk is how many bytes of blobs go in one request.
const blobChunk = 32 << 20

// sendMissing answers a missing_blobs error by uploading those blobs in
// chunks; it returns false when err is something else.
func (c *Client) sendMissing(store string, err error, data map[string][]byte) (bool, error) {
	var ae *APIError
	if !errors.As(err, &ae) || ae.Code != "missing_blobs" {
		return false, err
	}
	extra, _ := ae.Extra.(map[string]any)
	list, _ := extra["missing"].([]any)
	chunk, size := map[string]string{}, 0
	flush := func() error {
		if len(chunk) == 0 {
			return nil
		}
		_, err := c.Call("files.blobs", map[string]any{"store": store, "blobs": chunk})
		chunk, size = map[string]string{}, 0
		return err
	}
	for _, x := range list {
		sum := fmt.Sprint(x)
		b, ok := data[sum]
		if !ok {
			return true, fmt.Errorf("the server wants blob %s, which is not here", sum)
		}
		if size+len(b) > blobChunk {
			if err := flush(); err != nil {
				return true, err
			}
		}
		chunk[sum] = base64.StdEncoding.EncodeToString(b)
		size += len(b)
	}
	return true, flush()
}

// Push replaces a store's tree with a folder and snapshots it. Only the
// blobs the server lacks are sent.
func (c *Client) Push(store, dir string, args map[string]any) (any, error) {
	files, data, err := ReadDir(dir)
	if err != nil {
		return nil, err
	}
	if args == nil {
		args = map[string]any{}
	}
	args["store"], args["files"] = store, files
	res, err := c.Call("files.push", args)
	if retry, err := c.sendMissing(store, err, data); retry {
		if err != nil {
			return nil, err
		}
		return c.Call("files.push", args)
	}
	return res, err
}

// Pull writes a store's tree (at a snapshot or ref, or the working tree)
// into dir. Files whose bytes already match are left alone.
func (c *Client) Pull(store, dir, at string) (int, error) {
	res, err := c.Call("files.ls", map[string]any{"store": store, "at": at})
	if err != nil {
		return 0, err
	}
	var files []FileEntry
	if err := remarshal(res, &files); err != nil {
		return 0, err
	}
	n := 0
	for _, f := range files {
		dst := filepath.Join(dir, filepath.FromSlash(f.Path))
		if b, err := os.ReadFile(dst); err == nil {
			sum := sha256.Sum256(b)
			if hex.EncodeToString(sum[:]) == f.SHA256 {
				continue
			}
		}
		b, err := c.fileBytes(store, f.Path, at, "")
		if err != nil {
			return n, err
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return n, err
		}
		if err := os.WriteFile(dst, b, 0o644); err != nil {
			return n, err
		}
		n++
	}
	return n, nil
}

func (c *Client) fileBytes(store, path, at, zone string) ([]byte, error) {
	res, err := c.Call("files.cat", map[string]any{"store": store, "path": path, "at": at, "zone": zone, "as": "base64"})
	if err != nil {
		return nil, err
	}
	m, _ := res.(map[string]any)
	return base64.StdEncoding.DecodeString(fmt.Sprint(m["data"]))
}

func remarshal(in, out any) error {
	b, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}

// The folder export format:
//
//	store.json          {"format", "id", "meta", "files", "schema"} (authoritative)
//	docs.jsonl          {"path", "version", "body"} per line
//	tree/…, assets/…    the files of each zone
//	schema.sql          the app's schema, for people to read
//	tables/<name>.jsonl one row per line
const folderFormat = "slop-store/1"

type storeJSON struct {
	Format string            `json:"format"`
	ID     string            `json:"id"`
	Meta   map[string]string `json:"meta"`
	Files  []FileEntry       `json:"files"`
	Schema []map[string]any  `json:"schema"`
}

// ExportFolder writes a store in the folder format.
func (c *Client) ExportFolder(store, dir string) error {
	res, err := c.Call("store.export", map[string]any{"id": store})
	if err != nil {
		return err
	}
	var exp struct {
		ID     string `json:"id"`
		Bundle struct {
			Meta   map[string]string           `json:"meta"`
			Docs   []json.RawMessage           `json:"docs"`
			Files  []FileEntry                 `json:"files"`
			Schema []map[string]any            `json:"schema"`
			Tables map[string][]map[string]any `json:"tables"`
		} `json:"bundle"`
		Blobs map[string]string `json:"blobs"`
	}
	if err := remarshal(res, &exp); err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	b := exp.Bundle
	if err := writeJSON(filepath.Join(dir, "store.json"), storeJSON{Format: folderFormat, ID: exp.ID, Meta: b.Meta, Files: b.Files, Schema: b.Schema}); err != nil {
		return err
	}
	var docs bytes.Buffer
	for _, d := range b.Docs {
		docs.Write(d)
		docs.WriteByte('\n')
	}
	if err := os.WriteFile(filepath.Join(dir, "docs.jsonl"), docs.Bytes(), 0o644); err != nil {
		return err
	}
	for _, f := range b.Files {
		data, err := base64.StdEncoding.DecodeString(exp.Blobs[f.SHA256])
		if err != nil {
			return err
		}
		dst := filepath.Join(dir, f.Zone, filepath.FromSlash(f.Path))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, data, 0o644); err != nil {
			return err
		}
	}
	var schema strings.Builder
	for _, o := range b.Schema {
		fmt.Fprintf(&schema, "%s;\n\n", o["sql"])
	}
	if err := os.WriteFile(filepath.Join(dir, "schema.sql"), []byte(schema.String()), 0o644); err != nil {
		return err
	}
	if len(b.Tables) > 0 {
		if err := os.MkdirAll(filepath.Join(dir, "tables"), 0o755); err != nil {
			return err
		}
	}
	for name, rows := range b.Tables {
		var buf bytes.Buffer
		for _, r := range rows {
			line, _ := json.Marshal(r)
			buf.Write(line)
			buf.WriteByte('\n')
		}
		if err := os.WriteFile(filepath.Join(dir, "tables", name+".jsonl"), buf.Bytes(), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// ImportFolder makes a new store from the folder format.
func (c *Client) ImportFolder(dir, store string) (any, error) {
	var sj storeJSON
	raw, err := os.ReadFile(filepath.Join(dir, "store.json"))
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &sj); err != nil {
		return nil, fmt.Errorf("store.json: %w", err)
	}
	if sj.Format != folderFormat {
		return nil, fmt.Errorf("store.json: format %q, want %q", sj.Format, folderFormat)
	}
	docs, err := readJSONL(filepath.Join(dir, "docs.jsonl"))
	if err != nil {
		return nil, err
	}
	blobs := map[string]string{}
	for i, f := range sj.Files {
		b, err := os.ReadFile(filepath.Join(dir, f.Zone, filepath.FromSlash(f.Path)))
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256(b)
		sj.Files[i].SHA256, sj.Files[i].Size = hex.EncodeToString(sum[:]), int64(len(b)) // edited files win
		blobs[sj.Files[i].SHA256] = base64.StdEncoding.EncodeToString(b)
	}
	tables := map[string]any{}
	for _, o := range sj.Schema {
		name := fmt.Sprint(o["name"])
		rows, err := readJSONL(filepath.Join(dir, "tables", name+".jsonl"))
		if err == nil {
			tables[name] = rows
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, err
		}
	}
	if store == "" {
		store = sj.ID
	}
	return c.Call("import.folder", map[string]any{"store": store, "blobs": blobs,
		"bundle": map[string]any{"meta": sj.Meta, "docs": docs, "files": sj.Files, "schema": sj.Schema, "tables": tables}})
}

func readJSONL(path string) ([]any, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	out := []any{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 64<<20)
	for n := 1; sc.Scan(); n++ {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		dec := json.NewDecoder(bytes.NewReader(line))
		dec.UseNumber()
		var v any
		if err := dec.Decode(&v); err != nil {
			return nil, fmt.Errorf("%s:%d: %w", path, n, err)
		}
		out = append(out, v)
	}
	return out, sc.Err()
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}
