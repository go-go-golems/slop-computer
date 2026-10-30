package blobs

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/pkg/errors"
)

// Derived files are computed from a blob and can always be computed again:
// a gzipped copy (<sha>.gz) or a scaled image (<sha>.w480.jpg). They live
// beside the blobs in Root/derived/<first two hex digits>/<name>, outside
// blobs/, so Collect never mistakes them for unreferenced blobs.

var derivedPattern = regexp.MustCompile(`^[0-9a-f]{64}(\.[a-z0-9]+)+$`)

func (b *Blobs) derivedPath(name string) (string, error) {
	if !derivedPattern.MatchString(name) {
		return "", errors.New("invalid derived file name")
	}
	return filepath.Join(b.Root, "derived", name[:2], name), nil
}

// Derived returns the path of a derived file, or false when it is absent.
func (b *Blobs) Derived(name string) (string, bool) {
	p, err := b.derivedPath(name)
	if err != nil {
		return "", false
	}
	if _, err = os.Stat(p); err != nil {
		return "", false
	}
	return p, true
}

// PutDerived writes a derived file with write, atomically: readers see the
// whole file or none.
func (b *Blobs) PutDerived(name string, write func(io.Writer) error) (string, error) {
	p, err := b.derivedPath(name)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return "", err
	}
	tmp, err := os.CreateTemp(filepath.Dir(p), ".derive-*")
	if err != nil {
		return "", err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	err = write(tmp)
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", err
	}
	return p, os.Rename(tmp.Name(), p)
}

// CollectDerived removes derived files whose source blob is not kept (or,
// in a dry run, lists them). kept reports whether a blob stays.
func (b *Blobs) CollectDerived(kept func(sum string) bool, dryRun bool) ([]Collected, error) {
	var out []Collected
	root := filepath.Join(b.Root, "derived")
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if errors.Is(err, fs.ErrNotExist) && p == root {
			return filepath.SkipDir
		}
		if err != nil || d.IsDir() || strings.HasPrefix(d.Name(), ".") {
			return err
		}
		sum, _, _ := strings.Cut(d.Name(), ".")
		if kept(sum) {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		out = append(out, Collected{SHA256: d.Name(), Size: info.Size(), ModTime: info.ModTime()})
		if dryRun {
			return nil
		}
		return os.Remove(p)
	})
	return out, err
}
