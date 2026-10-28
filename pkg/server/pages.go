package server

import (
	"bytes"
	"embed"
	"html/template"
	"net/http"
	"net/url"
	"strings"

	"github.com/rs/zerolog/log"
)

//go:embed templates/*.tmpl
var templateFiles embed.FS

//go:embed static/*
var staticFiles embed.FS

var pages = template.Must(template.New("").Funcs(template.FuncMap{
	"join": strings.Join,
	"contains": func(l []string, s string) bool {
		for _, x := range l {
			if x == s {
				return true
			}
		}
		return false
	},
	"upper": strings.ToUpper,
	"deref": func(p *int) int {
		if p == nil {
			return 0
		}
		return *p
	},
}).ParseFS(templateFiles, "templates/*.tmpl"))

// render writes a server-rendered page. Data maps gain Local (local mode).
func (s *Server) render(w http.ResponseWriter, status int, name string, data map[string]any) {
	if data == nil {
		data = map[string]any{}
	}
	data["Local"] = s.Config.Local != nil
	var buf bytes.Buffer
	if err := pages.ExecuteTemplate(&buf, name, data); err != nil {
		log.Error().Err(err).Str("page", name).Msg("render page")
		http.Error(w, "page unavailable", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	w.WriteHeader(status)
	_, _ = w.Write(buf.Bytes())
}

func urlQueryEscape(s string) string { return url.QueryEscape(s) }

func (s *Server) staticFile(w http.ResponseWriter, r *http.Request) {
	http.StripPrefix("/static/", http.FileServerFS(mustSub(staticFiles, "static"))).ServeHTTP(w, r)
}
