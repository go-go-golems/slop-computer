package host

// SLOP3-012 phase 5c: fetch checks slop.fetch on every redirect, not only
// on the first request.

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestFetchRedirects(t *testing.T) {
	var outside atomic.Int64
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		outside.Add(1)
		_, _ = w.Write([]byte(`{"secret":true}`))
	}))
	defer other.Close()
	var allowedURL string
	allowed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/hop": // same origin: allowed
			http.Redirect(w, r, allowedURL+"/ok", http.StatusFound)
		case "/out": // to an origin the app did not declare
			http.Redirect(w, r, other.URL+"/internal", http.StatusFound)
		case "/loop":
			http.Redirect(w, r, allowedURL+"/loop", http.StatusFound)
		}
	}))
	defer allowed.Close()
	allowedURL = allowed.URL

	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "fx"})
	h.call(admin, "files.push", map[string]any{"store": "fx", "files": files(map[string]string{
		"app.json": `{"title":"F","actor":"actor.js","slop":{"fetch":["` + allowed.URL + `"]}}`,
		"actor.js": `const fetch = use('fetch');
defineActor({ actions: { async get(ctx, { url }) { const r = await fetch(url); return r.json(); } } });`,
	})})
	h.call(admin, "policy.set", map[string]any{"app": "fx", "capability": "fetch", "audience": "@admin", "value": "on"})
	get := func(path string) any {
		return h.call(admin, "actor.call", map[string]any{"store": "fx", "action": "get", "args": map[string]any{"url": allowed.URL + path}})
	}
	if got := get("/hop").(map[string]any); got["ok"] != true {
		t.Fatalf("same-origin redirect: %v", got)
	}
	e := h.fail(admin, "actor.call", map[string]any{"store": "fx", "action": "get", "args": map[string]any{"url": allowed.URL + "/out"}}, "permission_denied")
	if !strings.Contains(e["message"].(string), other.URL) || outside.Load() != 0 {
		t.Fatalf("redirect out: %v (other server hit %d times)", e, outside.Load())
	}
	e = h.fail(admin, "actor.call", map[string]any{"store": "fx", "action": "get", "args": map[string]any{"url": allowed.URL + "/loop"}}, "unavailable")
	if !strings.Contains(e["message"].(string), "10 redirects") {
		t.Fatalf("loop: %v", e)
	}
}
