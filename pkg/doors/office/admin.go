// Package office serves the back office (web/admin, built into
// pkg/doors/office/admin): a React app on the main host whose every button
// is a call to /api/v1/<verb> (SLOP3-010 PR 3).
package office

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"html/template"
	"net/http"

	"github.com/go-go-golems/slop-computer/pkg/config"
)

//go:embed admin/app.js admin/styles.css
var adminFS embed.FS

var adminPage = template.Must(template.New("admin").Parse(`<!doctype html>
<html lang="en" data-theme="light"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>slop · back office</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/admin/styles.css?v={{.V}}">
<script type="application/json" id="slop-admin">{{.Boot}}</script></head>
<body><div id="root"></div><script type="module" src="/admin/app.js?v={{.V}}"></script></body></html>`))

// Door serves / and /admin/* on the main host.
type Door struct{ Cfg *config.Config }

// Routes registers the back office's page and its two assets.
func (s *Door) Routes(m *http.ServeMux) {
	m.HandleFunc("GET /{$}", s.adminIndex)
	m.HandleFunc("GET /admin/{file}", s.adminAsset)
}

func (s *Door) adminIndex(w http.ResponseWriter, r *http.Request) {
	boot, _ := json.Marshal(map[string]any{"hosts": map[string][]string{"live": s.Cfg.Hosts.Live, "static": s.Cfg.Hosts.Static}})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	// The back office loads only its own script and styles and talks only
	// to this host; its data block is JSON, not script.
	w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	_ = adminPage.Execute(w, map[string]any{"Boot": template.JS(boot), "V": adminVersion})
}

// adminVersion busts caches when the embedded build changes: either file,
// since both are served immutable under the same ?v=.
var adminVersion = func() string {
	h := sha256.New()
	for _, name := range []string{"admin/app.js", "admin/styles.css"} {
		b, _ := adminFS.ReadFile(name)
		h.Write(b)
	}
	return hex.EncodeToString(h.Sum(nil)[:6])
}()

func (s *Door) adminAsset(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	b, err := adminFS.ReadFile("admin/" + name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	switch name {
	case "app.js":
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	case "styles.css":
		w.Header().Set("Content-Type", "text/css; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(b)
}
