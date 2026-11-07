package host

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// SLOP3-017 F1: a viewer's page runs an app without asking when the record
// says this viewer registered it (uid) or when they accepted its source's
// hash. Both fields are written by Pinboard's actor only: no page or client
// can write under apps/ (the manifest's rule there is "self", which nobody
// holds), and registerApp stamps uid from the authenticated visitor and
// sha256 from the source.
func TestPinboardAppRegistration(t *testing.T) {
	h, ada, bob, carol := kitchen(t)
	idOf := func(tok string) string { return h.call(tok, "whoami", nil).(map[string]any)["id"].(string) }
	adaID, bobID := idOf(ada), idOf(bob)
	h.call(ada, "grant.set", map[string]any{"store": "kitchen", "subject": bobID, "level": "admin"})

	register := func(tok, name, source string) map[string]any {
		t.Helper()
		return h.call(tok, "actor.call", map[string]any{"store": "kitchen", "action": "registerApp", "args": map[string]any{
			"name": name, "source": source, "title": "Hello", "w": 300, "h": 200, "state": map[string]any{"n": 0}, "via": "page", "note": "first",
		}}).(map[string]any)
	}
	doc := func(path string) map[string]any {
		t.Helper()
		out := h.call(ada, "docs.get", map[string]any{"store": "kitchen", "path": path}).(map[string]any)
		body, _ := out["body"].(map[string]any)
		return body
	}
	hash := func(s string) string { sum := sha256.Sum256([]byte(s)); return hex.EncodeToString(sum[:]) }

	src := "app('hello').title('Hello').view(ui.text('hi')).register()"
	r := register(ada, "hello", src)
	if r["version"] != 1.0 || r["sha256"] != hash(src) {
		t.Fatalf("registerApp: %v", r)
	}
	rec := doc("apps/hello")
	if rec["uid"] != adaID || rec["sha256"] != hash(src) || rec["source"] != src || rec["version"] != 1.0 || rec["w"] != 300.0 {
		t.Fatalf("record: %v", rec)
	}
	if v := doc("apps/hello/versions/1"); v["sha256"] != hash(src) || v["uid"] != adaID || v["note"] != "first" {
		t.Fatalf("version: %v", v)
	}

	// Bob, an admin too, cannot forge Ada's record: no direct write under
	// apps/, for him or for the owner.
	forged := map[string]any{"name": "hello", "source": "app('hello').register() // evil", "uid": adaID, "sha256": hash(src), "version": 2}
	h.fail(bob, "docs.set", map[string]any{"store": "kitchen", "path": "apps/hello", "data": forged}, "permission_denied")
	h.fail(ada, "docs.set", map[string]any{"store": "kitchen", "path": "apps/other", "data": forged}, "permission_denied")
	h.fail(bob, "docs.set", map[string]any{"store": "kitchen", "path": "apps/hello/versions/9", "data": forged}, "permission_denied")

	// Registering through the actor: the record names Bob, whatever he sends.
	evil := "app('hello').view(ui.text('changed')).register()"
	h.call(bob, "actor.call", map[string]any{"store": "kitchen", "action": "registerApp", "args": map[string]any{
		"name": "hello", "source": evil, "uid": adaID, "sha256": hash(src), "by": "Ada",
	}})
	if rec := doc("apps/hello"); rec["uid"] != bobID || rec["sha256"] != hash(evil) || rec["version"] != 2.0 || strings.Contains(asJSON(rec["by"]), "Ada") {
		t.Fatalf("Bob's version: %v", rec)
	}

	// Only admins register; names and sources are checked.
	h.fail(carol, "actor.call", map[string]any{"store": "kitchen", "action": "registerApp", "args": map[string]any{"name": "x", "source": src}}, "permission_denied")
	for _, args := range []map[string]any{{"name": "no spaces", "source": src}, {"name": "x", "source": "  "}} {
		_, out := api(t, h, ada, "actor.call", map[string]any{"store": "kitchen", "action": "registerApp", "args": args})
		if out["error"] == nil {
			t.Fatalf("registerApp %v: %v", args, out)
		}
	}

	// The shared log records each registration, as every board change.
	labels := []string{}
	for _, d := range h.call(ada, "docs.query", map[string]any{"store": "kitchen", "coll": "log"}).([]any) {
		labels = append(labels, asJSON(d.(map[string]any)["body"].(map[string]any)["label"]))
	}
	if all := strings.Join(labels, " "); !strings.Contains(all, "register hello v1") || !strings.Contains(all, "register hello v2") {
		t.Fatalf("log: %v", labels)
	}

	// Unregistering removes the record and keeps the versions.
	h.call(bob, "actor.call", map[string]any{"store": "kitchen", "action": "unregisterApp", "args": map[string]any{"name": "hello"}})
	h.fail(ada, "docs.get", map[string]any{"store": "kitchen", "path": "apps/hello"}, "not_found")
	if v := doc("apps/hello/versions/2"); v["uid"] != bobID {
		t.Fatalf("versions after unregister: %v", v)
	}
}
