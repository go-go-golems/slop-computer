package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/httpx"
	"github.com/go-go-golems/slop/pkg/ids"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/store"
)

// The assets capability keeps uploads in the store's assets zone, one file
// per asset, named by its id. The artifact capability republishes a
// self-contained app's page.

// assetTypes are the content types an upload may have (as on claude.ai).
var assetTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/avif": true,
	"video/mp4": true, "video/webm": true, "application/pdf": true,
	"font/woff": true, "font/woff2": true, "font/ttf": true, "font/otf": true,
	"text/css": true, "text/javascript": true, "application/javascript": true,
	"text/csv": true, "text/markdown": true, "application/json": true, "text/plain": true,
}

// uploadAsset takes a raw body on the sandbox origin: POST /_rt/assets.
func (s *Server) uploadAsset(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "revoked", "the view is closed or expired")
		return
	}
	if _, ok := grantedCaps(v)["assets"]; !ok {
		httpx.Fail(w, 403, "not_granted", "this view was not granted assets")
		return
	}
	ct := strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0])
	if !assetTypes[ct] {
		httpx.Fail(w, 415, "unsupported_type", "unsupported content type "+ct)
		return
	}
	limit := int64(rt.MaxAssetBytes)
	if ct == "text/css" || strings.HasSuffix(ct, "javascript") {
		limit = rt.MaxCodeAssetBytes
	}
	st, err := s.viewStore(r.Context(), v)
	if err != nil {
		failView(w, err)
		return
	}
	sum, n, err := st.Blobs.PutReader(io.LimitReader(r.Body, limit+1), limit, "")
	if err != nil {
		httpx.Fail(w, 413, "too_large", "an asset is at most 20 MiB (CSS and JS 16 MiB)")
		return
	}
	id := ids.New("a", 8)
	if _, err := st.Do(r.Context(), viewWho(v), func(t *store.Turn) error {
		_, err := t.PutBlob("assets", id, sum, n, ct)
		return err
	}); err != nil {
		failView(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"id": id, "url": "/_blob/" + id, "sizeBytes": n, "contentType": ct})
}

// serveAssetBlob serves /_blob/<id> on the sandbox origin: bytes, never a
// page, revalidated on every use so a deleted asset is gone for good.
func (s *Server) serveAssetBlob(w http.ResponseWriter, r *http.Request, storeID, id string) {
	st, err := s.Env.K.Store(r.Context(), storeID)
	if err != nil {
		notFound(w)
		return
	}
	f, err := st.File(r.Context(), "assets", id)
	if err != nil {
		notFound(w)
		return
	}
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	s.serveBlob(w, r, st, f, cachePrivate)
}

func (s *Server) rpcAssetsList(ctx context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	st, err := s.viewStore(ctx, v)
	if err != nil {
		return nil, err
	}
	fs, err := st.Files(ctx, "assets", "")
	if err != nil {
		return nil, err
	}
	var used int64
	out := make([]map[string]any, 0, len(fs))
	for _, f := range fs {
		if strings.Contains(f.Path, "/") {
			continue // files put by verbs, not uploads
		}
		used += f.Size
		out = append(out, map[string]any{"id": f.Path, "url": "/_blob/" + f.Path, "sizeBytes": f.Size, "contentType": f.Type})
	}
	return map[string]any{"assets": out, "usage": map[string]any{"bytes": used, "count": len(out)}}, nil
}

func (s *Server) rpcAssetsDelete(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ ID string }](raw)
	if err != nil {
		return nil, err
	}
	st, err := s.viewStore(ctx, v)
	if err != nil {
		return nil, err
	}
	var ok bool
	if _, err := st.Do(ctx, viewWho(v), func(t *store.Turn) error {
		ok, err = t.RemoveFile("assets", a.ID)
		return err
	}); err != nil {
		return nil, err
	}
	if !ok {
		return nil, rtErr("not_found", "no asset %q", a.ID)
	}
	return map[string]bool{"deleted": true}, nil
}

// rpcArtifactPublish saves a new version of a self-contained app from its
// page: the entry page replaced, the other files kept, main moved, every
// view reloaded. Only admins publish app code (decision D9).
func (s *Server) rpcArtifactPublish(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		HTML string `json:"html"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if v.Level < rt.LevelAdmin || v.Role != string(access.AudAdmin) {
		return nil, rtErr("not_writer", "only admins publish")
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(a.HTML)), "<!doctype") {
		return nil, rtErr("invalid_content", "publish a complete document, doctype first")
	}
	if len(a.HTML) > 16<<20 {
		return nil, rtErr("too_large", "a page is at most 16 MiB")
	}
	st, err := s.Env.K.Store(ctx, v.App)
	if err != nil {
		return nil, err
	}
	man, _ := s.appManifest(ctx, st, int64(v.Version))
	entry := man.Entry()
	var n int64
	_, err = st.Do(ctx, viewWho(v), func(t *store.Turn) error {
		cur, err := st.Ref(ctx, "main")
		if err != nil || cur != int64(v.Version) {
			return rtErr("conflict", "a newer version was published")
		}
		files, err := st.SnapshotFiles(ctx, cur)
		if err != nil {
			return err
		}
		keep := map[string]bool{entry: true}
		for _, f := range files {
			keep[f.Path] = true
			if f.Path != entry {
				if _, err := t.PutBlob("tree", f.Path, f.SHA256, f.Size, f.Type); err != nil {
					return err
				}
			}
		}
		if _, err := t.PutFile("tree", entry, []byte(a.HTML), "text/html; charset=utf-8"); err != nil {
			return err
		}
		tree, err := t.TreeFiles()
		if err != nil {
			return err
		}
		for _, f := range tree {
			if !keep[f.Path] {
				if _, err := t.RemoveFile("tree", f.Path); err != nil {
					return err
				}
			}
		}
		n, err = t.Snapshot("published from the page", "main")
		return err
	})
	var f *rtFail
	if errors.As(err, &f) {
		return nil, f
	}
	if err != nil {
		return nil, err
	}
	return map[string]any{"version": n}, nil
}
