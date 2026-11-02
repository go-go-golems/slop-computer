package server

import (
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

//go:embed assets/*
var assetFS embed.FS

var assetHashes sync.Map // name → short hash

// assetURL is an embedded asset's versioned URL (cached for a year).
func assetURL(name string) string {
	if h, ok := assetHashes.Load(name); ok {
		return "/_slop/" + name + "?v=" + h.(string)
	}
	b, err := fs.ReadFile(assetFS, "assets/"+name)
	if err != nil {
		return "/_slop/" + name
	}
	sum := sha256.Sum256(b)
	h := hex.EncodeToString(sum[:])[:12]
	assetHashes.Store(name, h)
	return "/_slop/" + name + "?v=" + h
}

// serveAsset serves /_slop/<name> from the embedded assets.
func serveAsset(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/_slop/")
	b, err := fs.ReadFile(assetFS, "assets/"+name)
	if err != nil || strings.Contains(name, "/") {
		notFound(w)
		return
	}
	u := assetURL(name)
	cache := cacheMoving
	if v := r.URL.Query().Get("v"); v != "" && strings.HasSuffix(u, "?v="+v) {
		cache = cacheImmutable
	}
	w.Header().Set("Cache-Control", cache)
	w.Header().Set("Content-Type", store.TypeOf(name))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(b)
}

// frameOrigins are the origins allowed to frame sandboxed apps.
func (s *Server) frameOrigins() []string {
	out := []string{s.Cfg.MainURL()}
	for _, h := range s.Cfg.Hosts.Live {
		out = append(out, s.Cfg.Origin(h))
	}
	return out
}

var versionPath = regexp.MustCompile(`^/v/([0-9]+)/(.*)$`)

// serveSandbox serves a store+app origin: s<label>.<sandbox host>.
func (s *Server) serveSandbox(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	label, _, _ := strings.Cut(r.Host, ".")
	if strings.HasPrefix(label, "p") {
		s.servePreview(w, r, label)
		return
	}
	storeID, app, err := s.Sys.Origin(ctx, label)
	if err != nil {
		notFound(w)
		return
	}
	r = r.WithContext(context.WithValue(ctx, originStore{}, storeID))
	p := r.URL.Path
	get := r.Method == http.MethodGet || r.Method == http.MethodHead
	switch {
	case p == "/_rt/events" && get:
		s.viewEvents(w, r)
		return
	case p == "/_rt/rpc" && r.Method == http.MethodPost:
		s.viewRPC(w, r)
		return
	case p == "/_rt/assets" && r.Method == http.MethodPost:
		s.uploadAsset(w, r)
		return
	case strings.HasPrefix(p, "/_rt/sample") && r.Method == http.MethodPost:
		s.serveSampleRoute(w, r, p)
		return
	case !get:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	case strings.HasPrefix(p, "/_slop/"):
		serveAsset(w, r)
		return
	case strings.HasPrefix(p, "/_s/"):
		s.serveStoreFile(w, r, nil)
		return
	case strings.HasPrefix(p, "/_blob/"):
		s.serveAssetBlob(w, r, storeID, strings.TrimPrefix(p, "/_blob/"))
		return
	}
	w.Header().Set("Content-Security-Policy", "frame-ancestors "+strings.Join(s.frameOrigins(), " "))
	m := versionPath.FindStringSubmatch(p)
	if m == nil {
		if p == "/" || p == "" {
			http.Redirect(w, r, "/v/0/", http.StatusFound)
			return
		}
		notFound(w)
		return
	}
	n, _ := strconv.ParseInt(m[1], 10, 64)
	as, err := s.Env.K.Store(ctx, app)
	if err != nil {
		notFound(w)
		return
	}
	if n == 0 {
		if n, err = as.Ref(ctx, "main"); err != nil {
			notFound(w)
			return
		}
	}
	man, _ := s.appManifest(ctx, as, n)
	entry := man.Entry()
	rest := m[2]
	if rest != "" && rest != entry {
		if strings.HasSuffix(rest, "/") {
			rest += "index.html"
		}
		f, err := as.SnapshotFile(ctx, n, rest)
		if err != nil {
			notFound(w)
			return
		}
		// public: the sandbox serves an app's files to anyone who has its
		// origin (the label is the capability), so a shared cache adds no
		// exposure; a snapshot's bytes never change
		s.writeStoreBytes(w, r, storeBytes{st: as, f: f, vis: public, mut: immutable})
		return
	}
	f, err := as.SnapshotFile(ctx, n, entry)
	if err != nil {
		notFound(w)
		return
	}
	page, err := as.ReadFile(f)
	if err != nil {
		notFound(w)
		return
	}
	parent := r.URL.Query().Get("parent")
	if !slices.Contains(s.frameOrigins(), parent) {
		parent = s.frameOrigins()[0]
	}
	declared := map[string]any{}
	if man != nil {
		for name := range man.Caps.Declared {
			declared[name] = map[string]any{}
		}
	}
	boot := map[string]any{"mode": "app", "parentOrigin": parent,
		"runtime": map[string]any{"target": storeID, "app": app, "version": n, "caps": declared}}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", cachePrivate)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(inject(page, boot))
}

// appManifest reads app.json of an app store's snapshot (nil when absent).
func (s *Server) appManifest(ctx context.Context, as *store.Store, n int64) (*apps.Manifest, error) {
	f, err := as.SnapshotFile(ctx, n, apps.File)
	if err != nil {
		return nil, err
	}
	raw, err := as.ReadFile(f)
	if err != nil {
		return nil, err
	}
	return apps.Parse(raw)
}

var (
	headOpen = regexp.MustCompile(`(?i)<head[^>]*>`)
	doctype  = regexp.MustCompile(`(?i)^\s*<!doctype[^>]*>`)
)

// inject puts the boot data and the runtime first in a page's head.
func inject(page []byte, boot any) []byte {
	raw, _ := json.Marshal(boot)
	// json.Marshal escapes <, > and & (as \u003c…), so the data cannot close the script.
	var head bytes.Buffer
	head.WriteString(`<script type="application/json" id="slop-boot">`)
	head.Write(raw)
	head.WriteString(`</script><script src="` + assetURL("claude.js") + `"></script>`)
	return insertHead(page, head.Bytes())
}

// insertHead inserts tags first in a page's head (after the doctype when
// there is no head tag).
func insertHead(page, tags []byte) []byte {
	if loc := headOpen.FindIndex(page); loc != nil {
		return append(append(append([]byte{}, page[:loc[1]]...), tags...), page[loc[1]:]...)
	}
	if loc := doctype.FindIndex(page); loc != nil {
		return append(append(append([]byte{}, page[:loc[1]]...), tags...), page[loc[1]:]...)
	}
	return append(append([]byte{}, tags...), page...)
}
