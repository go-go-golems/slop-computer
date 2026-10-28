package server

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/doc"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

func TestHelpForAdmins(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead)
	get := func(c *http.Client, path string, headers map[string]string) (int, string, http.Header) {
		req, _ := http.NewRequest("GET", h.ts.URL+path, nil)
		for k, v := range headers {
			req.Header.Set(k, v)
		}
		resp, err := c.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b), resp.Header
	}
	noRedirect := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	// Admins in the browser: the page, with this server's hosts filled in.
	code, body, _ := get(manuel.c, "/help/agents", nil)
	if code != 200 || !strings.Contains(body, "<h1>Working with your coding agent</h1>") || !strings.Contains(body, "slop auth login --server "+h.ts.URL) ||
		!strings.Contains(body, "http://site.test/") || strings.Contains(body, "your-slop-server") {
		t.Fatalf("admin page %d:\n%.600s", code, body)
	}
	// Agents with a token: Markdown.
	code, body, hdr := get(http.DefaultClient, "/help/agents.md", map[string]string{"Authorization": "Bearer " + tok})
	if code != 200 || !strings.HasPrefix(hdr.Get("Content-Type"), "text/markdown") || !strings.Contains(body, "## 2. Log in, once per agent") || strings.Contains(body, doc.Server) {
		t.Fatalf("markdown %d %s:\n%.300s", code, hdr.Get("Content-Type"), body)
	}
	// Signed out: the browser goes to sign-in, a script gets 401.
	if code, _, hdr = get(noRedirect, "/help/agents", nil); code != http.StatusSeeOther || !strings.HasPrefix(hdr.Get("Location"), "/auth/login?return=%2Fhelp%2Fagents") {
		t.Fatalf("signed out: %d %s", code, hdr.Get("Location"))
	}
	if code, _, _ = get(http.DefaultClient, "/help/agents.md", nil); code != 401 {
		t.Fatalf("signed out markdown: %d", code)
	}
	if code, _, _ = get(manuel.c, "/help/nope", nil); code != 404 {
		t.Fatalf("unknown topic: %d", code)
	}

	// Pending people do not get it.
	hp := newHarness(t, store.RolePending)
	sasha := hp.signIn("sasha")
	req, _ := http.NewRequest("GET", hp.ts.URL+"/help/agents", nil)
	resp, err := sasha.c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("pending: %d", resp.StatusCode)
	}
}
