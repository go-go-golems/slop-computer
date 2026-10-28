package server

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

func TestWorkshopAndResolvedRoutes(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	h.srv.Config.Workshop = fstest.MapFS{
		"index.html":      {Data: []byte("<!doctype html><div id=root></div>")},
		"assets/app-1.js": {Data: []byte("console.log(1)")},
	}
	// Signed out, a Workshop path goes to sign-in and comes back.
	c := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := c.Get(h.ts.URL + "/watch/pricing/3")
	if err != nil || resp.StatusCode != 303 || resp.Header.Get("Location") != "/auth/login?return=%2Fwatch%2Fpricing%2F3" {
		t.Fatalf("signed out: %v %v", err, resp)
	}
	manuel := h.signIn("manuel")
	for _, p := range []string{"/", "/watch/pricing/3", "/routes", "/artifacts", "/site", "/admin"} {
		resp, err := manuel.c.Get(h.ts.URL + p)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != 200 || !strings.Contains(string(b), "id=root") {
			t.Fatalf("%s: %d %s", p, resp.StatusCode, b)
		}
	}
	resp, err = manuel.c.Get(h.ts.URL + "/static/workshop/assets/app-1.js")
	if err != nil || resp.StatusCode != 200 || !strings.Contains(resp.Header.Get("Cache-Control"), "immutable") {
		t.Fatalf("asset: %v %v", err, resp)
	}

	// ?resolve=1 adds what each route serves now.
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "journal", map[string]any{"title": "Journal", "kind": "data", "type": "post"}, nil, map[string]string{"posts/a.md": "---\ntitle: A\n---\n"})
	h.pushFiles(tok, "index", map[string]any{"title": "Index", "kind": "page"}, map[string]any{"reads": map[string]string{"posts": "journal"}}, map[string]string{"index.html": "<p>hi"})
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/", "page": "index"}, nil)
	var rs []routeView
	if code := manuel.do("GET", "/api/routes?resolve=1", nil, &rs); code != 200 || len(rs) != 1 || rs[0].N != 1 || rs[0].Data["posts"].Artifact != "journal" || rs[0].Data["posts"].N != 1 {
		t.Fatalf("resolved routes %d %+v", code, rs)
	}
}
