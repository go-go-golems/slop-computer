package server

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"
)

// sourceHash is web/build-stamp.mjs's sourceHash: sha256 over
// "<path>\0<sha256 of the file>\n" for build.mjs, the lockfile and every
// file under src/, sorted by path relative to the package.
func sourceHash(t *testing.T, dir string) string {
	t.Helper()
	files := []string{"build.mjs"}
	for _, l := range []string{"package-lock.json", "pnpm-lock.yaml"} {
		if _, err := os.Stat(filepath.Join(dir, l)); err == nil {
			files = append(files, l)
		}
	}
	err := filepath.WalkDir(filepath.Join(dir, "src"), func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(dir, p)
		files = append(files, filepath.ToSlash(rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	h := sha256.New()
	for _, f := range files {
		b, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(b)
		fmt.Fprintf(h, "%s\x00%s\n", f, hex.EncodeToString(sum[:]))
	}
	return hex.EncodeToString(h.Sum(nil))
}

var stampRe = regexp.MustCompile(`source sha256:([0-9a-f]{64})`)

// Committed build outputs carry the hash of the sources they were built
// from (web/build-stamp.mjs). A source change without a rebuild fails here,
// so the embedded back office, its app copy and the page runtime cannot
// drift from web/ unnoticed.
func TestBuildOutputsFresh(t *testing.T) {
	root := filepath.Join("..", "..")
	outputs := []struct {
		pkg, make string
		outs      []string
	}{
		{"web/runtime", "make runtime", []string{"pkg/server/assets/claude.js"}},
		{"web/admin", "make admin", []string{"pkg/doors/office/admin/app.js", "pkg/doors/office/admin/styles.css",
			"apps/backoffice/app.js", "apps/backoffice/styles.css"}},
	}
	for _, o := range outputs {
		pkg, outs := o.pkg, o.outs
		want := sourceHash(t, filepath.Join(root, pkg))
		for _, out := range outs {
			f, err := os.Open(filepath.Join(root, out))
			if err != nil {
				t.Fatal(err)
			}
			line, _ := bufio.NewReader(f).ReadString('\n')
			_ = f.Close()
			m := stampRe.FindStringSubmatch(line)
			switch {
			case m == nil:
				t.Errorf("%s has no source stamp: rebuild it from %s (%s)", out, pkg, o.make)
			case m[1] != want:
				t.Errorf("%s is stale: %s changed since it was built (%s)", out, pkg, o.make)
			}
		}
	}
}
