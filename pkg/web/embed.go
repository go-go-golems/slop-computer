//go:build embed

package web

import (
	"embed"
	"io/fs"
)

//go:embed all:workshop
var embedded embed.FS

// Workshop is the embedded build: index.html and assets/.
var Workshop = mustSub(embedded, "workshop")

func mustSub(f fs.FS, dir string) fs.FS {
	sub, err := fs.Sub(f, dir)
	if err != nil {
		panic(err)
	}
	return sub
}
