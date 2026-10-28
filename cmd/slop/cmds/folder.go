package cmds

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

// A pushed folder: every file except .slop/, .git/, node_modules/ and
// dotfiles becomes part of the version's tree, except slop.json, which is
// the version's manifest. .slop/artifact.json remembers the artifact and the
// version the folder was last pulled or pushed as (the base of the next push).

// slopJSON is a folder's slop.json. Fields other than these are kept in the
// manifest as they are (for example reads, tokens, tool).
type slopJSON struct {
	Artifact string  `json:"artifact,omitempty"`
	Title    string  `json:"title,omitempty"`
	Kind     string  `json:"kind,omitempty"`
	Type     string  `json:"type,omitempty"`
	Project  *string `json:"project,omitempty"`
}

type folderState struct {
	Server   string `json:"server,omitempty"`
	Artifact string `json:"artifact"`
	Base     int    `json:"base"`
}

type folder struct {
	Dir      string
	Files    map[string][]byte
	Sums     map[string]string
	Manifest json.RawMessage
	Meta     slopJSON
}

func skipped(rel string, d fs.DirEntry) bool {
	name := d.Name()
	if rel == "." {
		return false
	}
	return strings.HasPrefix(name, ".") || name == "node_modules"
}

func readFolder(dir string) (*folder, error) {
	f := &folder{Dir: dir, Files: map[string][]byte{}, Sums: map[string]string{}}
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		if skipped(rel, d) {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		rel = filepath.ToSlash(rel)
		b, err := os.ReadFile(p) // #nosec G304 -- files of the folder the user pushes
		if err != nil {
			return err
		}
		if rel == "slop.json" {
			if !json.Valid(b) {
				return errors.New("slop.json is not valid JSON")
			}
			f.Manifest = b
			return json.Unmarshal(b, &f.Meta)
		}
		h := sha256.Sum256(b)
		f.Files[rel] = b
		f.Sums[rel] = hex.EncodeToString(h[:])
		return nil
	})
	if err != nil {
		return nil, errors.Wrap(err, "read "+dir)
	}
	if len(f.Files) == 0 {
		return nil, errors.Errorf("%s has no files to push", dir)
	}
	return f, nil
}

func statePath(dir string) string { return filepath.Join(dir, ".slop", "artifact.json") }

func readState(dir string) (folderState, bool) {
	var st folderState
	b, err := os.ReadFile(statePath(dir)) // #nosec G304 -- the folder's own state file
	if err != nil || json.Unmarshal(b, &st) != nil {
		return st, false
	}
	return st, true
}

func writeState(dir string, st folderState) error {
	if err := os.MkdirAll(filepath.Join(dir, ".slop"), 0o750); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(st, "", "  ")
	return os.WriteFile(statePath(dir), append(b, '\n'), 0o600)
}
