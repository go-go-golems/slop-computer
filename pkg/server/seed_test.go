package server

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/seed"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// A seed push pins links to data at main to the version the linked data has
// (SLOP-012): /_d/media/main/… in the catalog becomes /_d/media/<n>/…, a
// content URL. The linked data is pushed first even when listed later, and
// the seed directory itself is left as it was.
func TestSeedPinsDataLinks(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	api := client.New(h.ts.URL, h.token(manuel.id(), store.ScopeRead, store.ScopeWrite))
	ctx := context.Background()

	dir := t.TempDir()
	write := func(art string, n int, name, content string) {
		t.Helper()
		p := filepath.Join(seed.VersionDir(dir, art, n), name)
		if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := `{"title":"Weft","cover":{"src":"/_d/media/main/files/a.png"},"other":"/_d/elsewhere/main/x.png"}`
	write("catalog", 1, "weft.json", catalog)
	write("media", 1, "files/a.png", "png one")
	f := &seed.File{Artifacts: []seed.Artifact{ // the catalog comes first in the file
		{ID: "catalog", Title: "Catalog", Kind: "data", Versions: []seed.Version{{N: 1, Message: "catalog"}}},
		{ID: "media", Title: "Media", Kind: "data", Versions: []seed.Version{{N: 1, Message: "media"}}},
	}}
	push := func() {
		t.Helper()
		if _, err := seed.Push(ctx, dir, f, seed.Options{Admin: api}); err != nil {
			t.Fatal(err)
		}
	}
	tok := h.token(manuel.id(), store.ScopeRead)
	record := func(n int) string {
		t.Helper()
		code, body, _ := h.fetch(h.ts.Listener.Addr().String(), "/api/artifacts/catalog/versions/"+strconv.Itoa(n)+"/files/weft.json",
			map[string]string{"Authorization": "Bearer " + tok})
		if code != 200 {
			t.Fatalf("catalog v%d: %d %s", n, code, body)
		}
		return string(body)
	}
	push()
	if got := record(1); !strings.Contains(got, `"/_d/media/1/files/a.png"`) || !strings.Contains(got, `"/_d/elsewhere/main/x.png"`) {
		t.Fatalf("pinned catalog: %s", got)
	}
	if b, _ := os.ReadFile(filepath.Join(seed.VersionDir(dir, "catalog", 1), "weft.json")); string(b) != catalog {
		t.Fatalf("the seed directory changed: %s", b)
	}

	// The media gets a new version: the catalog follows with a new one.
	write("media", 2, "files/a.png", "png two")
	f.Artifacts[1].Versions = append(f.Artifacts[1].Versions, seed.Version{N: 2, Message: "media 2"})
	push()
	if got := record(2); !strings.Contains(got, `"/_d/media/2/files/a.png"`) {
		t.Fatalf("catalog after new media: %s", got)
	}
}
