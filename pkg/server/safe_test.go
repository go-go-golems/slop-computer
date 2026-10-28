package server

import (
	"io"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// form posts a form as a browser would, with the session's CSRF token.
func (b *browser) form(path string, v url.Values) (int, string) {
	b.h.t.Helper()
	v.Set("csrf", b.csrf)
	resp, err := b.c.PostForm(b.h.ts.URL+path, v)
	if err != nil {
		b.h.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode, resp.Header.Get("Location")
}

func TestSafeMode(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	for _, body := range []string{"<p>one", "<p>two"} {
		h.pushFiles(tok, "pricing", map[string]any{"title": "Pricing", "kind": "page"}, nil, map[string]string{"index.html": body})
	}
	manuel.do("PUT", "/api/routes", map[string]any{"host": "site.test", "path": "/pricing", "page": "pricing"}, nil)

	resp, err := manuel.c.Get(h.ts.URL + "/_/")
	if err != nil {
		t.Fatal(err)
	}
	page, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || !strings.Contains(string(page), "<code>/pricing</code>") || !strings.Contains(string(page), "main → v2") {
		t.Fatalf("safe page %d %s", resp.StatusCode, page)
	}
	if code, loc := manuel.form("/_/route", url.Values{"host": {"site.test"}, "path": {"/pricing"}, "version": {"1"}}); code != 303 || !strings.Contains(loc, "done=") {
		t.Fatalf("point: %d %s", code, loc)
	}
	rs, _ := h.st.Routes(t.Context(), "site.test")
	if len(rs) != 1 || rs[0].Version == nil || *rs[0].Version != 1 {
		t.Fatalf("after point %+v", rs)
	}
	if code, _ := manuel.form("/_/undo", url.Values{"host": {"site.test"}, "path": {"/pricing"}}); code != 303 {
		t.Fatalf("undo: %d", code)
	}
	rs, _ = h.st.Routes(t.Context(), "site.test")
	if rs[0].Version != nil {
		t.Fatalf("after undo %+v", rs[0])
	}
	// Without the CSRF token nothing happens.
	resp, err = manuel.c.PostForm(h.ts.URL+"/_/route", url.Values{"host": {"site.test"}, "path": {"/pricing"}, "version": {"1"}})
	if err != nil || resp.StatusCode != 403 {
		t.Fatalf("no csrf: %v %v", err, resp)
	}
	toks, _ := h.st.Tokens(t.Context(), "")
	if code, _ := manuel.form("/_/revoke", url.Values{"id": {toks[0].ID}}); code != 303 {
		t.Fatalf("revoke: %d", code)
	}
	if h.bearer(tok, "GET", "/api/artifacts", nil, nil) != 401 {
		t.Fatal("revoked token still works")
	}
}
