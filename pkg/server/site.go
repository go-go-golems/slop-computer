package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// Cache classes (SLOP-012): a URL naming a version or hash never changes;
// a URL naming a place that moves is fresh for a minute, then revalidated
// in the background.
const (
	cacheImmutable = "public, max-age=31536000, immutable"
	cacheMoving    = "public, max-age=60, stale-while-revalidate=600"
	cachePrivate   = "private, no-cache"
)

// resolved is a request matched to a mount and a store.
type resolved struct {
	m     system.Match
	store string
	row   system.StoreRow
	run   kernel.Running
}

// errNoStore: the mount matched but names no store (yet).
var errNoStore = errors.New("no store here")

// resolve finds the mount and store for a site-host request.
func (s *Server) resolve(ctx context.Context, host, reqPath string) (*resolved, error) {
	mounts, err := s.Sys.Mounts(ctx, host)
	if err != nil {
		return nil, err
	}
	m, ok := system.BestMount(mounts, reqPath)
	if !ok {
		return nil, system.ErrNotFound
	}
	res := &resolved{m: m, store: m.Mount.Store}
	if res.store == "" {
		res.store = m.Params[m.Mount.StoreParam]
	}
	row, err := s.Sys.StoreByID(ctx, res.store)
	if errors.Is(err, system.ErrNotFound) || (err == nil && m.Mount.Type != "" && row.Type != m.Mount.Type) {
		return res, errNoStore
	}
	if err != nil {
		return nil, err
	}
	res.row = row
	if res.run, err = s.Env.K.Running(ctx, res.store); err != nil {
		return nil, err
	}
	return res, nil
}

// serveStatic serves a static host: files only, no cookies, no sessions.
// Everything is served as an id-less guest, so public means @guest view.
func (s *Server) serveStatic(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/_s/") {
		s.serveStoreFile(w, r, nil, false) // the static host has no sessions
		return
	}
	ctx := r.Context()
	res, err := s.resolve(ctx, r.Host, r.URL.Path)
	if err != nil {
		notFound(w)
		return
	}
	d, _, err := s.Env.K.Access.Can(ctx, nil, res.store, rt.LevelView, "reading", true)
	if err != nil || !d.OK || res.run.N == 0 {
		notFound(w)
		return
	}
	if s.serveActorRoute(w, r, res, nil) {
		return
	}
	as, err := s.Env.K.Store(ctx, res.run.App)
	if err != nil {
		notFound(w)
		return
	}
	entry := res.run.Manifest.Entry()
	rest := res.m.Rest
	// A page at the mount root must end in a slash, so that its relative
	// URLs (style.css) resolve under the mount and no Referer is needed.
	if rest == "" && !strings.HasSuffix(r.URL.Path, "/") {
		if _, err := as.SnapshotFile(ctx, res.run.N, entry); err == nil {
			target := r.URL.Path + "/"
			if r.URL.RawQuery != "" {
				target += "?" + r.URL.RawQuery
			}
			http.Redirect(w, r, target, http.StatusPermanentRedirect)
			return
		}
	}
	name := rest
	switch {
	case name == "":
		name = entry
	case strings.HasSuffix(r.URL.Path, "/"):
		name = strings.TrimSuffix(name, "/") + "/index.html"
	}
	if f, err := as.SnapshotFile(ctx, res.run.N, name); err == nil {
		s.serveBlob(w, r, as, f, cacheMoving)
		return
	}
	// A directory without its slash: send it to the slash.
	if !strings.HasSuffix(r.URL.Path, "/") {
		if _, err := as.SnapshotFile(ctx, res.run.N, name+"/index.html"); err == nil {
			http.Redirect(w, r, r.URL.Path+"/", http.StatusPermanentRedirect)
			return
		}
	}
	// A site with a not-found page has no client-side routes: a missing
	// path gets that page, with a 404.
	if m := res.run.Manifest; m != nil && m.NotFound != "" {
		if f, err := as.SnapshotFile(ctx, res.run.N, m.NotFound); err == nil {
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Content-Type", f.Type)
			if file, err := as.Blobs.Open(f.SHA256); err == nil {
				defer file.Close()
				w.WriteHeader(http.StatusNotFound)
				_, _ = io.Copy(w, file)
				return
			}
		}
		notFound(w)
		return
	}
	// Client-side routes: a path without an extension gets the entry page.
	if path.Ext(name) == "" {
		if f, err := as.SnapshotFile(ctx, res.run.N, entry); err == nil {
			s.serveBlob(w, r, as, f, cacheMoving)
			return
		}
	}
	notFound(w)
}

// serveStoreFile serves /_s/<store>/<n|ref>/<path> (the tree at a snapshot
// or ref) and /_s/<store>/assets/<path>, to whoever may read the store.
// isolate is for a host whose origin is trusted (the live host: the shell
// and its sessions): the files are anyone's who can push to a store, so they
// get a sandbox CSP (no scripts, no requests), and what is not media is a
// download rather than a page.
func (s *Server) serveStoreFile(w http.ResponseWriter, r *http.Request, p *access.Principal, isolate bool) {
	ctx := r.Context()
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/_s/"), "/", 3)
	if len(parts) < 3 || parts[2] == "" {
		notFound(w)
		return
	}
	id, at, name := parts[0], parts[1], parts[2]
	d, _, err := s.Env.K.Access.Can(ctx, p, id, rt.LevelView, "reading files", true)
	if err != nil || !d.OK {
		notFound(w)
		return
	}
	st, err := s.Env.K.Store(ctx, id)
	if err != nil {
		notFound(w)
		return
	}
	public := p == nil || d.Audience == access.AudGuest
	if !public {
		pd, _, _ := s.Env.K.Access.Can(ctx, nil, id, rt.LevelView, "", true)
		public = pd.OK
	}
	cache := cachePrivate
	var f store.File
	if at == "assets" {
		f, err = st.File(ctx, "assets", name)
		if public {
			cache = cacheMoving
		}
	} else {
		var n int64
		n, err = st.Ref(ctx, at)
		if err == nil {
			f, err = st.SnapshotFile(ctx, n, name)
		}
		if public {
			cache = cacheMoving
			if _, numErr := strconv.ParseInt(at, 10, 64); numErr == nil {
				cache = cacheImmutable
			}
		}
	}
	if err != nil {
		notFound(w)
		return
	}
	if isolate {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
		if !isMedia(f.Type) {
			w.Header().Set("Content-Disposition", "attachment")
		}
	}
	s.serveBlob(w, r, st, f, cache)
}

// serveBlob writes a file's bytes with its type, an ETag (its hash) and a
// cache class; ranges and conditional requests are handled.
func (s *Server) serveBlob(w http.ResponseWriter, r *http.Request, st *store.Store, f store.File, cache string) {
	etag := `"` + f.SHA256 + `"`
	h := w.Header()
	h.Set("ETag", etag)
	h.Set("Cache-Control", cache)
	h.Set("X-Content-Type-Options", "nosniff")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	file, err := st.Blobs.Open(f.SHA256)
	if err != nil {
		http.Error(w, "file unavailable", http.StatusServiceUnavailable)
		return
	}
	defer file.Close()
	h.Set("Content-Type", f.Type)
	http.ServeContent(w, r, "", time.Time{}, file)
}

func notFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`<!doctype html><meta charset=utf-8><title>Not found</title>` +
		`<body style="font:16px system-ui;margin:4rem auto;max-width:32rem;color:#222"><h1 style="font-weight:600">Not found</h1>` +
		`<p>There is nothing at this address.</p></body>`))
}
