package host

// SLOP3-015 view 15: the curator's actor. "today" asks the model once per
// day, as the member who calls it (their allowance pays), and keeps the
// picks in picks/<day> for everyone; an unusable answer falls back to
// picks seeded by the date. Guests cannot trigger the call.
//
// SLOP3-018: the catalog is catalog-data's, read through a binding and a
// grant to store:catalog-curator; the page gets it from the "catalog"
// action, guests included.

import (
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/llm"
)

func TestCatalogCuratorApp(t *testing.T) {
	h := newHarness(t)
	h.a.SetLLM(&llm.Fake{})
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := deployCatalogData(t, h, admin)
	h.call(admin, "store.new", map[string]any{"id": "catalog-curator"})
	h.call(admin, "files.push", map[string]any{"store": "catalog-curator", "files": appDir(t, "catalog-curator")})
	h.call(admin, "bind.set", map[string]any{"store": "catalog-curator", "alias": "catalog", "target": "catalog-data"})
	// Without the grant to store:catalog-curator, the binding reads nothing.
	h.fail(admin, "actor.call", map[string]any{"store": "catalog-curator", "action": "catalog"}, "permission_denied")
	h.call(admin, "grant.set", map[string]any{"store": "catalog-data", "subject": "store:catalog-curator", "level": "view"})
	if st := h.call(admin, "app.status", map[string]any{"store": "catalog-curator"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	h.call(admin, "grant.set", map[string]any{"store": "catalog-curator", "subject": "@guest", "level": "view"})
	h.call(admin, "grant.set", map[string]any{"store": "catalog-curator", "subject": "@member", "level": "interact"})
	h.call(admin, "policy.set", map[string]any{"app": "catalog-curator", "capability": "sample", "audience": "@member", "value": "on"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/catalog/curator", "store": "catalog-curator"})

	call := func(s *site, v map[string]any) map[string]any {
		return rpc(s, v, "slop.call", map[string]any{"action": "today", "args": map[string]any{}})
	}
	b, s := h.browser(), h.site(live)
	b.signIn("ada@example.com")
	signInSite(t, h, s, b, live, "/catalog/curator")
	_, v := openView(s, live, "/catalog/curator", "")

	// Without model access for Ada, the action refuses (nothing stored).
	if out := call(s, v); out["error"] == nil {
		t.Fatalf("today without model access: %v", out)
	}
	h.call(admin, "llm.set", map[string]any{"subject": "ada@example.com", "value": "on", "budget": 100000})
	out := call(s, v)
	res, _ := out["result"].(map[string]any)
	// The fake model answers in prose: the picks are seeded by the date.
	if res == nil || res["by"] != "seed" || res["model"] != "test/fake" || len(res["picks"].([]any)) == 0 {
		t.Fatalf("today: %v", out)
	}
	day := res["day"].(string)
	if d := docBody(h, admin, "catalog-curator", "picks/"+day); d == nil || d["by"] != "seed" {
		t.Fatalf("stored picks: %v", d)
	}
	// A second call returns the stored picks.
	if again := call(s, v)["result"].(map[string]any); again["at"] != res["at"] {
		t.Fatalf("second call made new picks: %v vs %v", again, res)
	}
	// A guest reads the catalog and the picks, but cannot run "today".
	g := h.site(live)
	_, vg := openView(g, live, "/catalog/curator", "")
	if c := result(t, rpc(g, vg, "slop.call", map[string]any{"action": "catalog", "args": map[string]any{}})); c["count"] != 2.0 {
		t.Fatalf("guest catalog: %v", c)
	}
	if d := result(t, rpc(g, vg, "db.get", map[string]any{"path": "picks/" + day})); d["exists"] != true {
		t.Fatalf("guest reads picks: %v", d)
	}
	if out := call(g, vg); out["error"] == nil || !strings.Contains(fmtAny(out["error"]), "permission") && !strings.Contains(fmtAny(out["error"]), "forbidden") {
		t.Fatalf("guest today: %v", out)
	}
}
