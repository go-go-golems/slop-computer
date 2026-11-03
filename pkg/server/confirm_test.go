package server

// Tests from SLOP3-002 phase W6 (confirmations for governance writes); formerly w6_test.go.

import (
	"strings"
	"testing"
)

// W6 exit: a governance call made through an app fails with
// confirmation_required until the person allows it, from the CLI or in the
// shell; the approval holds for the same person, view and call only;
// another person cannot allow it; secret values stay out of the summary.
func TestConfirmations(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write", "admin")
	h.tokenFor("pat@example.com")
	h.tokenFor("quinn@example.com")
	live := h.cfg.Hosts.Live[0]
	toolApp(t, h, admin, "office", officeActor, "system")
	h.call(admin, "app.trust", map[string]any{"app": "office", "module": "system"})
	idOf := func(email string) string {
		for _, x := range h.call(admin, "people.ls", map[string]any{"kind": "user"}).([]any) {
			if r := x.(map[string]any); r["email"] == email {
				return r["id"].(string)
			}
		}
		t.Fatalf("no %s", email)
		return ""
	}
	pat, quinn := idOf("pat@example.com"), idOf("quinn@example.com")
	letIn := func(id string) map[string]any {
		return map[string]any{"store": "office", "action": "letIn", "args": map[string]any{"id": id}}
	}
	confirmID := func(e map[string]any) string { return e["extra"].(map[string]any)["confirm"].(string) }

	// The CLI path: fail, approve, repeat.
	e := h.fail(admin, "actor.call", letIn(pat), "confirmation_required")
	id1 := confirmID(e)
	if msg := e["message"].(string); !strings.Contains(msg, "people.role") || !strings.Contains(msg, pat) || !strings.Contains(msg, "slop confirm approve "+id1) {
		t.Fatalf("message = %q", msg)
	}
	if again := confirmID(h.fail(admin, "actor.call", letIn(pat), "confirmation_required")); again != id1 {
		t.Fatalf("a waiting call got a new confirmation: %s vs %s", again, id1)
	}
	h.fail(mia, "confirm.approve", map[string]any{"id": id1}, "not_found") // not hers
	h.call(admin, "confirm.approve", map[string]any{"id": id1})
	if got := h.call(admin, "actor.call", letIn(pat)).(map[string]any); got["role"] != "member" {
		t.Fatalf("after approval: %v", got)
	}
	h.call(admin, "actor.call", letIn(pat)) // the approval holds for the same call
	if other := confirmID(h.fail(admin, "actor.call", letIn(quinn), "confirmation_required")); other == id1 {
		t.Fatal("a different call reused the approval")
	}
	// Secret values are not shown.
	e = h.fail(admin, "actor.call", map[string]any{"store": "office", "action": "verb",
		"args": map[string]any{"name": "secret.set", "args": map[string]any{"app": "office", "name": "K", "value": "s3cret"}}}, "confirmation_required")
	if strings.Contains(e["message"].(string), "s3cret") || !strings.Contains(e["message"].(string), "(hidden)") {
		t.Fatalf("secret in summary: %q", e["message"])
	}

	// The shell path: a view's slop.call fails with the id; the shell reads
	// the summary and allows it; the page repeats the call.
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/office", "store": "office"})
	ab := h.browser()
	ab.signIn("admin@example.com")
	as := h.site(live)
	signInSite(t, h, as, ab, live, "/office")
	st, v := openView(as, live, "/office", "")
	if st != 200 {
		t.Fatalf("view: %d %v", st, v)
	}
	out := rpc(as, v, "slop.call", map[string]any{"action": "letIn", "args": map[string]any{"id": quinn}})
	fe, _ := out["error"].(map[string]any)
	if fe == nil || fe["code"] != "confirmation_required" || fe["confirm"] == nil {
		t.Fatalf("page call: %v", out)
	}
	cid := fe["confirm"].(string)
	r, c := as.do("GET", live, "/_site/confirm/"+cid, nil, nil)
	if r.StatusCode != 200 || !strings.Contains(c["summary"].(string), quinn) || c["title"] != "Tool" {
		t.Fatalf("shell GET: %d %v", r.StatusCode, c)
	}
	// Another person's session cannot see or allow it.
	mb := h.browser()
	mb.signIn("mia@example.com")
	ms := h.site(live)
	signInSite(t, h, ms, mb, live, "/office")
	if r, _ := ms.do("POST", live, "/_site/confirm/"+cid, map[string]any{}, nil); r.StatusCode != 404 {
		t.Fatalf("another person allowed it: %d", r.StatusCode)
	}
	// A cross-origin POST (the app's own sandbox page) is refused.
	if r, _ := as.do("POST", live, "/_site/confirm/"+cid, map[string]any{}, map[string]string{"Origin": "http://sabc." + h.cfg.Hosts.Sandbox}); r.StatusCode != 403 {
		t.Fatalf("cross-origin approval: %d", r.StatusCode)
	}
	if r, _ := as.do("POST", live, "/_site/confirm/"+cid, map[string]any{}, nil); r.StatusCode != 200 {
		t.Fatalf("shell POST: %d", r.StatusCode)
	}
	out = rpc(as, v, "slop.call", map[string]any{"action": "letIn", "args": map[string]any{"id": quinn}})
	if res, _ := out["result"].(map[string]any); res == nil || res["role"] != "member" {
		t.Fatalf("page call after approval: %v", out)
	}
	// The approval was for that view: the same call from the CLI asks again.
	h.call(admin, "people.role", map[string]any{"id": quinn, "role": "pending"})
	h.fail(admin, "actor.call", letIn(quinn), "confirmation_required")
	// Direct calls by the person are not confirmed.
	h.call(admin, "people.role", map[string]any{"id": quinn, "role": "member"})
}
