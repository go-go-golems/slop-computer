package francois_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/francois"
	"github.com/go-go-golems/slop-computer/pkg/seed"
)

func sum(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

// fakeFrancois answers the studio API the way francois does: release HTML
// only for free samples and only without a token; media are public.
func fakeFrancois(t *testing.T) *httptest.Server {
	const free, paid, png = "<p>free sample", "<p>paid", "\x89PNG"
	writes := 0
	mux := http.NewServeMux()
	auth := func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer fr_tok" {
				http.Error(w, "no", 401)
				return
			}
			h(w, r)
		}
	}
	js := func(v any) http.HandlerFunc {
		return func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(v) }
	}
	mux.HandleFunc("GET /api/studio/artifacts", auth(js([]map[string]any{{"id": "weft", "hasDraft": true}})))
	mux.HandleFunc("GET /api/studio/artifacts/weft", auth(js(map[string]any{
		"artifact": map[string]any{"id": "weft", "title": "Weft", "visibility": "listed", "launchMode": "tab",
			"page": map[string]any{"body": "![](/media/med_ab?w=640)", "cover": "med_ab", "gallery": []string{}}},
		"creators": []string{},
		// Newest first, as francois lists them.
		"releases": []map[string]any{
			{"id": "rel_2", "version": "1.1.0", "state": "published", "freeSample": false, "manifest": map[string]any{"room": map[string]any{}},
				"createdAt": "2026-10-02T00:00:00Z", "files": []map[string]any{{"id": "fil_2", "role": "html", "name": "w2.html", "size": len(paid), "sha256": sum(paid)}},
				"attachments": []any{}},
			{"id": "rel_1", "version": "1.0.0", "state": "published", "freeSample": true, "manifest": map[string]any{"sample": map[string]any{}},
				"createdAt": "2026-10-01T00:00:00Z", "files": []map[string]any{{"id": "fil_1", "role": "html", "name": "w1.html", "size": len(free), "sha256": sum(free)}},
				"attachments": []any{}},
		}})))
	mux.HandleFunc("GET /api/studio/posts", auth(js([]any{})))
	mux.HandleFunc("GET /api/studio/creators", auth(js([]any{})))
	mux.HandleFunc("GET /api/studio/media", auth(js([]map[string]any{{"id": "med_ab", "sha256": sum(png), "mediaType": "image/png", "size": len(png)}})))
	mux.HandleFunc("GET /api/admin/users", auth(func(w http.ResponseWriter, _ *http.Request) { http.Error(w, "scope", 403) }))
	mux.HandleFunc("GET /api/admin/instances", auth(js([]any{map[string]any{}, map[string]any{}})))
	mux.HandleFunc("GET /media/med_ab", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(png)) })
	mux.HandleFunc("GET /api/releases/{rel}/files/{file}/download", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			http.Error(w, `{"error":{"code":"token_not_allowed"}}`, 401)
			return
		}
		if r.PathValue("rel") != "rel_1" {
			http.Error(w, `{"error":{"code":"login_required"}}`, 401)
			return
		}
		_, _ = w.Write([]byte(free))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writes++
		}
		http.NotFound(w, r)
	})
	ts := httptest.NewServer(mux)
	t.Cleanup(func() {
		ts.Close()
		if writes > 0 {
			t.Errorf("the API source sent %d non-GET requests", writes)
		}
	})
	return ts
}

func TestImportFromAPI(t *testing.T) {
	ctx := context.Background()
	ts := fakeFrancois(t)
	src := francois.NewAPI(ts.URL, "fr_tok")
	snap, err := src.Snapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(snap.Artifacts) != 1 || len(snap.Users) != 0 || snap.Counts["instances"] != 2 {
		t.Fatalf("snapshot %+v", snap)
	}
	if rels := snap.Artifacts[0].Releases; rels[0].ID != "rel_1" || !rels[0].HTML.Public || rels[1].HTML.Public {
		t.Fatalf("releases oldest first, only the free sample public: %+v", rels)
	}
	cache := filepath.Join(t.TempDir(), "cache")
	out := filepath.Join(t.TempDir(), "out")
	census, err := francois.Extract(ctx, src, snap, out, francois.Options{Cache: cache})
	if err != nil {
		t.Fatal(err)
	}
	v1, _ := os.ReadFile(filepath.Join(seed.VersionDir(out, "weft", 1), "index.html"))
	v2, _ := os.ReadFile(filepath.Join(seed.VersionDir(out, "weft", 2), "index.html"))
	if string(v1) != "<p>free sample" || !strings.Contains(string(v2), "was not available to the importer") {
		t.Fatalf("v1 %q v2 %q", v1, v2)
	}
	if census.HTMLOriginal != 1 || census.HTMLMissing != 1 || census.Media.Copied != 1 {
		t.Fatalf("census %+v", census)
	}
	// The second extract reads files from the cache.
	if _, err := os.Stat(filepath.Join(cache, sum("\x89PNG")[:2], sum("\x89PNG"))); err != nil {
		t.Fatalf("cache: %v", err)
	}
	ts.Close()
	out2 := filepath.Join(t.TempDir(), "out2")
	if _, err := francois.Extract(ctx, src, snap, out2, francois.Options{Cache: cache}); err != nil {
		t.Fatalf("extract from cache with francois gone: %v", err)
	}
}
