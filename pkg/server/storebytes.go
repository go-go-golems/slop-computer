package server

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Bytes from a store are described by facts, and writeStoreBytes derives
// every header from them (SLOP3-005, guide section 6.8). No handler picks
// a Cache-Control or an isolation header for store bytes itself.

// visibility: may a shared cache keep the response? Only when an
// anonymous visitor could read the resource; never inferred from who is
// asking (a guest reads private stores through a share link's grant).
type visibility int

const (
	private visibility = iota
	public
)

// mutability: can the bytes behind this address change?
type mutability int

const (
	moving    mutability = iota // a ref (main, draft), the current version, an upload that can be deleted
	immutable                   // a snapshot by number
	noStore                     // never kept (previews)
)

type storeBytes struct {
	st  *store.Store
	f   store.File
	vis visibility
	mut mutability
}

func (b storeBytes) cacheControl() string {
	switch {
	case b.mut == noStore:
		return "private, no-store"
	case b.vis != public:
		return cachePrivate
	case b.mut == immutable:
		return cacheImmutable
	}
	return cacheMoving
}

// visibilityOf answers whether an anonymous visitor may read a store.
func (s *Server) visibilityOf(ctx context.Context, storeID string) visibility {
	if d, _, err := s.Env.K.Access.Can(ctx, nil, storeID, rt.LevelView, "", true); err == nil && d.OK {
		return public
	}
	return private
}

// trustedHost: the origins that hold sessions (main and live hosts).
func (s *Server) trustedHost(host string) bool {
	k := s.Cfg.HostKind(host)
	return k == "main" || k == "live"
}

// resolveStoreFile finds a store's file by address: "assets" (the uploads
// zone), a snapshot number, or a ref name, and says whether the address
// always names the same bytes.
func resolveStoreFile(ctx context.Context, st *store.Store, at, name string) (store.File, mutability, error) {
	if at == "assets" {
		f, err := st.File(ctx, "assets", name)
		return f, moving, err
	}
	n, err := st.Ref(ctx, at)
	if err != nil {
		return store.File{}, moving, err
	}
	f, err := st.SnapshotFile(ctx, n, name)
	mut := moving
	if _, numErr := strconv.ParseInt(at, 10, 64); numErr == nil {
		mut = immutable
	}
	return f, mut, err
}

// writeStoreBytes is the one writer of store bytes. On a trusted origin,
// and for uploads anywhere, the bytes never run as a page: a sandbox CSP,
// and a download unless they are media. Pages run only from a store's
// tree on the static and sandbox hosts, which hold no sessions.
func (s *Server) writeStoreBytes(w http.ResponseWriter, r *http.Request, b storeBytes) {
	h := w.Header()
	if s.trustedHost(r.Host) || b.f.Zone == "assets" {
		h.Set("Content-Security-Policy", "sandbox; default-src 'none'")
		if !isMedia(b.f.Type) {
			h.Set("Content-Disposition", "attachment")
		}
	}
	etag := `"` + b.f.SHA256 + `"`
	h.Set("ETag", etag)
	h.Set("Cache-Control", b.cacheControl())
	h.Set("X-Content-Type-Options", "nosniff")
	if match := r.Header.Get("If-None-Match"); match != "" && strings.Contains(match, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	file, err := b.st.Blobs.Open(b.f.SHA256)
	if err != nil {
		http.Error(w, "file unavailable", http.StatusServiceUnavailable)
		return
	}
	defer file.Close()
	h.Set("Content-Type", b.f.Type)
	http.ServeContent(w, r, "", time.Time{}, file)
}
