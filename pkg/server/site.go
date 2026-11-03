package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"path"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
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
	m     registry.Match
	store string
	row   sysdb.StoreRow
	run   kernel.Running
}

// errNoStore: the mount matched but names no store (yet).
var errNoStore = errors.New("no store here")

// resolve finds the mount and store for a site-host request.
func (s *Server) resolve(ctx context.Context, host, reqPath string) (*resolved, error) {
	mounts, err := s.Registry.Mounts(ctx, host)
	if err != nil {
		return nil, err
	}
	m, ok := registry.BestMount(mounts, reqPath)
	if !ok {
		return nil, sysdb.ErrNotFound
	}
	res := &resolved{m: m, store: m.Mount.Store}
	if res.store == "" {
		res.store = m.Params[m.Mount.StoreParam]
	}
	row, err := s.Registry.StoreByID(ctx, res.store)
	if errors.Is(err, sysdb.ErrNotFound) || (err == nil && m.Mount.Type != "" && row.Type != m.Mount.Type) {
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
		s.serveStoreFile(w, r, nil)
		return
	}
	ctx := r.Context()
	res, err := s.resolve(ctx, r.Host, r.URL.Path)
	if err != nil {
		notFound(w)
		return
	}
	d, _, err := s.Env.K.Access.Can(ctx, nil, res.store, rt.LevelView, "reading", true)
	if err != nil || !d.OK || !res.run.Usable() {
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
		s.writeStoreBytes(w, r, storeBytes{st: as, f: f, vis: public, mut: moving}) // anyone may read (checked above)
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
			s.writeStoreBytes(w, r, storeBytes{st: as, f: f, vis: public, mut: moving}) // anyone may read (checked above)
			return
		}
	}
	notFound(w)
}

// serveStoreFile serves /_s/<store>/<n|ref>/<path> (the tree at a snapshot
// or ref) and /_s/<store>/assets/<path>, to whoever may read the store.
// The files are anyone's who can push to the store: writeStoreBytes keeps
// them from running as pages on a trusted host.
func (s *Server) serveStoreFile(w http.ResponseWriter, r *http.Request, p *access.Principal) {
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
	f, mut, err := resolveStoreFile(ctx, st, at, name)
	if err != nil {
		notFound(w)
		return
	}
	s.writeStoreBytes(w, r, storeBytes{st: st, f: f, vis: s.visibilityOf(ctx, id), mut: mut})
}

func notFound(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`<!doctype html><meta charset=utf-8><title>Not found</title>` +
		`<body style="font:16px system-ui;margin:4rem auto;max-width:32rem;color:#222"><h1 style="font-weight:600">Not found</h1>` +
		`<p>There is nothing at this address.</p></body>`))
}
