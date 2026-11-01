package server

import (
	"strings"
	"testing"
)

// W8: apps/workshop installs as documented; a person comments on an
// element of a draft, an agent replies with the snapshot that answers it,
// and publishing moves main and notes it in the open threads.
func TestWorkshopApp(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	static := h.cfg.Hosts.Static[0]
	h.call(admin, "store.new", map[string]any{"id": "workshop"})
	h.call(admin, "files.push", map[string]any{"store": "workshop", "files": appDir(t, "workshop")})
	if st := h.call(admin, "app.status", map[string]any{"store": "workshop"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("workshop is broken: %v", st)
	}
	h.call(admin, "app.trust", map[string]any{"app": "workshop", "module": "workshop"})
	call := func(action string, args map[string]any) any {
		return h.call(admin, "actor.call", map[string]any{"store": "workshop", "action": action, "args": args})
	}

	h.call(admin, "store.new", map[string]any{"id": "site"})
	h.call(admin, "files.push", map[string]any{"store": "site", "files": files(map[string]string{"index.html": "<h1>one</h1>"})})
	h.call(admin, "grant.set", map[string]any{"store": "site", "subject": "@guest", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": static, "path": "/site", "store": "site"})
	d := h.call(admin, "files.push", map[string]any{"store": "site", "ref": "draft", "files": files(map[string]string{"index.html": "<h1>two</h1>"})}).(map[string]any)

	ov := fmtAny(call("overview", nil))
	if !strings.Contains(ov, `"id":"site"`) || strings.Contains(ov, `"id":"workshop"`) {
		t.Fatalf("overview = %s", ov)
	}
	pv := call("preview", map[string]any{"store": "site", "n": d["n"], "parent": h.cfg.Origin(h.cfg.Hosts.Live[0])}).(map[string]any)
	if !strings.HasPrefix(pv["url"].(string), h.cfg.Scheme+"://p") {
		t.Fatalf("preview = %v", pv)
	}
	th := call("comment", map[string]any{"store": "site", "n": d["n"], "text": "make it bigger",
		"anchor": map[string]any{"selector": "h1", "tag": "h1", "text": "two", "fx": 0.5, "fy": 0.5}}).(map[string]any)
	d2 := h.call(admin, "files.push", map[string]any{"store": "site", "ref": "draft", "files": files(map[string]string{"index.html": "<h1 style=\"font-size:4em\">two</h1>"})}).(map[string]any)
	call("reply", map[string]any{"thread": th["id"], "text": "bigger now", "n": d2["n"], "agent": true})
	call("publish", map[string]any{"store": "site", "n": d2["n"]})
	if _, body := h.get(static, "/site/"); !strings.Contains(body, "4em") {
		t.Fatalf("publish: the site serves %s", body)
	}
	doc := h.call(admin, "docs.get", map[string]any{"store": "workshop", "path": "threads/" + th["id"].(string)}).(map[string]any)["body"].(map[string]any)
	cs := doc["comments"].([]any)
	if len(cs) != 3 || cs[1].(map[string]any)["agent"] != true || !strings.Contains(fmtAny(cs[2]), "published #") {
		t.Fatalf("thread = %s", fmtAny(doc))
	}
	call("resolve", map[string]any{"thread": th["id"]})
	if s := h.call(admin, "docs.get", map[string]any{"store": "workshop", "path": "threads/" + th["id"].(string)}).(map[string]any)["body"].(map[string]any)["status"]; s != "resolved" {
		t.Fatalf("status = %v", s)
	}
}
