package server

// Tests from SLOP3-002 phase W7 (the back office as an app); formerly w7_test.go.

import (
	"strings"
	"testing"
)

// W7: apps/backoffice installs as documented, refuses until trusted, and
// its one action runs the back office's verbs as the visitor.
func TestBackofficeApp(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "backoffice"})
	h.call(admin, "files.push", map[string]any{"store": "backoffice", "files": appDir(t, "backoffice")})
	if st := h.call(admin, "app.status", map[string]any{"store": "backoffice"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("backoffice is broken: %v", st)
	}
	verb := func(tok, name string, args map[string]any) (int, map[string]any) {
		return api(t, h, tok, "actor.call", map[string]any{"store": "backoffice", "action": "verb", "args": map[string]any{"name": name, "args": args}})
	}
	if _, out := verb(admin, "server.hosts", nil); !strings.Contains(fmtAny(out), "not trusted with the system module") {
		t.Fatalf("untrusted: %v", out)
	}
	h.call(admin, "app.trust", map[string]any{"app": "backoffice", "module": "system"})
	if st, out := verb(admin, "server.hosts", nil); st != 200 || !strings.Contains(fmtAny(out), h.cfg.Hosts.Live[0]) {
		t.Fatalf("server.hosts: %d %v", st, out)
	}
	if st, out := verb(admin, "people.ls", map[string]any{}); st != 200 || !strings.Contains(fmtAny(out), "mia@example.com") {
		t.Fatalf("people.ls: %d %v", st, out)
	}
	// Members hold no level on it (no grants), so the action refuses them.
	if st, _ := verb(mia, "people.ls", map[string]any{}); st == 200 {
		t.Fatal("a member used the back office app")
	}
}
