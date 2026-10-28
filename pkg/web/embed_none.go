//go:build !embed

package web

import (
	"io/fs"
	"os"
	"path/filepath"
)

// Workshop is pkg/web/workshop on disk (found from the working directory up
// to go.mod), or nil when it has not been generated.
var Workshop fs.FS = diskWorkshop()

func diskWorkshop() fs.FS {
	dir, err := os.Getwd()
	if err != nil {
		return nil
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			w := filepath.Join(dir, "pkg", "web", "workshop")
			if _, err := os.Stat(filepath.Join(w, "index.html")); err != nil {
				return nil
			}
			return os.DirFS(w)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return nil
		}
		dir = parent
	}
}
