// Package blobs stores immutable file contents on disk, keyed by their
// sha256. Adapted from github.com/go-go-golems/francois@106776a
// pkg/catalog/releases (Blobs): the storage key is the hash itself.
package blobs

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/pkg/errors"
)

// Blobs stores files beneath Root/blobs/<first two hex digits>/<sha256>.
type Blobs struct{ Root string }

// ErrTooLarge reports an upload over its size limit.
var ErrTooLarge = errors.New("file exceeds the size limit")

// ErrHashMismatch reports content whose hash differs from the expected one.
var ErrHashMismatch = errors.New("content does not match its sha256")

var sumPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// ValidSum reports whether s looks like a lowercase hex sha256.
func ValidSum(s string) bool { return sumPattern.MatchString(s) }

func Open(dir string) (*Blobs, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(abs, "blobs"), 0o700); err != nil {
		return nil, errors.Wrap(err, "create blob directory")
	}
	return &Blobs{Root: abs}, nil
}

func (b *Blobs) path(sum string) (string, error) {
	if !ValidSum(sum) {
		return "", errors.New("invalid sha256")
	}
	return filepath.Join(b.Root, "blobs", sum[:2], sum), nil
}

// Sum is the hex sha256 of data.
func Sum(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// Put stores data and returns its sha256. Existing blobs are reused.
func (b *Blobs) Put(data []byte) (string, error) {
	sum, _, err := b.PutReader(bytesReader(data), int64(len(data)), "")
	return sum, err
}

// PutReader streams r (at most limit bytes) into a temporary file while
// hashing it, then renames it into place. When want is set, content whose
// hash differs is rejected with ErrHashMismatch.
func (b *Blobs) PutReader(r io.Reader, limit int64, want string) (string, int64, error) {
	tmp, err := os.CreateTemp(filepath.Join(b.Root, "blobs"), ".upload-*")
	if err != nil {
		return "", 0, err
	}
	defer func() { _ = os.Remove(tmp.Name()) }()
	h := sha256.New()
	size, err := io.Copy(io.MultiWriter(tmp, h), io.LimitReader(r, limit+1))
	if err == nil && size > limit {
		err = ErrTooLarge
	}
	if err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return "", 0, err
	}
	sum := hex.EncodeToString(h.Sum(nil))
	if want != "" && want != sum {
		return "", 0, ErrHashMismatch
	}
	final, err := b.path(sum)
	if err != nil {
		return "", 0, err
	}
	if fi, e := os.Stat(final); e == nil && fi.Size() == size {
		return sum, size, nil
	}
	if err = os.MkdirAll(filepath.Dir(final), 0o700); err != nil {
		return "", 0, err
	}
	return sum, size, os.Rename(tmp.Name(), final)
}

// Stat returns the stored size of sum, or false when it is absent.
func (b *Blobs) Stat(sum string) (int64, bool) {
	p, err := b.path(sum)
	if err != nil {
		return 0, false
	}
	fi, err := os.Stat(p)
	if err != nil {
		return 0, false
	}
	return fi.Size(), true
}

// Missing returns the sums that are not stored.
func (b *Blobs) Missing(sums []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, s := range sums {
		if seen[s] {
			continue
		}
		seen[s] = true
		if _, ok := b.Stat(s); !ok {
			out = append(out, s)
		}
	}
	return out
}

// Open returns the stored file for streaming.
func (b *Blobs) Open(sum string) (*os.File, error) {
	p, err := b.path(sum)
	if err != nil {
		return nil, err
	}
	return os.Open(p) // #nosec G304 -- sum is validated against sumPattern
}

// Read returns the stored bytes after verifying their hash.
func (b *Blobs) Read(sum string) ([]byte, error) {
	p, err := b.path(sum)
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(p) // #nosec G304 -- sum is validated against sumPattern
	if err != nil {
		return nil, errors.Wrap(err, "read blob")
	}
	if Sum(data) != sum {
		return nil, ErrHashMismatch
	}
	return data, nil
}

// Collected is a blob GC removed (or, in a dry run, would remove).
type Collected struct {
	SHA256  string
	Size    int64
	ModTime time.Time
}

// Collect removes blobs that no version references and that are older than
// before. Young unreferenced blobs are kept: a push uploads its blobs before
// it stores the version that references them. With dryRun nothing is
// removed.
func (b *Blobs) Collect(referenced map[string]bool, before time.Time, dryRun bool) ([]Collected, error) {
	var out []Collected
	err := filepath.WalkDir(filepath.Join(b.Root, "blobs"), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		sum := d.Name()
		if !ValidSum(sum) || referenced[sum] {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.ModTime().Before(before) {
			return nil
		}
		if !dryRun {
			if err := os.Remove(p); err != nil {
				return errors.Wrap(err, "remove blob")
			}
		}
		out = append(out, Collected{SHA256: sum, Size: info.Size(), ModTime: info.ModTime()})
		return nil
	})
	return out, err
}
