package web

import (
	"embed"
	"net/http"
	"path"
)

// slop's icon: a blocky S on black, in the style of francois's F
// (icon/favicon.svg is the source; favicon.ico holds the same design drawn
// at 16 and 32 pixels).
//
//go:embed icon/favicon.ico icon/favicon.svg
var icons embed.FS

// IsFavicon reports a request for one of slop's icons.
func IsFavicon(p string) bool { return p == "/favicon.ico" || p == "/favicon.svg" }

// Favicon serves /favicon.ico and /favicon.svg: on the main host and the
// live hosts, whose pages are slop's own (static hosts serve a site's).
func Favicon(w http.ResponseWriter, r *http.Request) {
	name := path.Base(r.URL.Path)
	b, err := icons.ReadFile("icon/" + name)
	if err != nil || !IsFavicon(r.URL.Path) {
		http.NotFound(w, r)
		return
	}
	if name == "favicon.svg" {
		w.Header().Set("Content-Type", "image/svg+xml")
	} else {
		w.Header().Set("Content-Type", "image/x-icon")
	}
	w.Header().Set("Cache-Control", "public, max-age=86400")
	_, _ = w.Write(b)
}
