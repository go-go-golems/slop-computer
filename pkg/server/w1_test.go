package server

import (
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/apps"
)

const toolActor = `
const system = use('system');
defineActor({
  actions: {
    has(ctx) { return system ? Object.keys(system).sort() : null; },
    async people(ctx) { return (await system.people.list({ kind: 'user' })).length; },
    async role(ctx, { id, role }) { return await system.people.setRole(id, role); },
    async grant(ctx, { store, subject, level }) { return await system.grants.set(store, subject, level); },
  },
});
`

// toolApp pushes an app that declares the system module; members may
// interact with it.
func toolApp(t *testing.T, h *harness, admin, id, actorJS string, modules ...string) {
	t.Helper()
	mods := `"` + strings.Join(modules, `","`) + `"`
	h.call(admin, "store.new", map[string]any{"id": id})
	h.call(admin, "files.push", map[string]any{"store": id, "files": files(map[string]string{
		"app.json":   `{"title":"Tool","actor":"actor.js","capabilities":{"db":{}},"slop":{"modules":[` + mods + `]}}`,
		"actor.js":   actorJS,
		"index.html": "<!doctype html><title>tool</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": id, "subject": "@member", "level": "interact"})
}

// W1 exit: use('system') is null until an admin trusts the app with it,
// an object after, and null again after untrust (which restarts actors).
// Calls run as the visitor, with their token's scopes.
func TestModuleTrust(t *testing.T) {
	if _, err := apps.Parse([]byte(`{"slop":{"modules":["nope"]}}`)); err == nil || !strings.Contains(err.Error(), "unknown") {
		t.Fatalf("unknown module parsed: %v", err)
	}
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com")
	toolApp(t, h, admin, "tool", toolActor, "system")
	has := func() any { return h.call(admin, "actor.call", map[string]any{"store": "tool", "action": "has"}) }

	if got := has(); got != nil {
		t.Fatalf("untrusted: use('system') = %v", got)
	}
	h.fail(mia, "app.trust", map[string]any{"app": "tool", "module": "system"}, "permission_denied")
	h.fail(admin, "app.trust", map[string]any{"app": "tool", "module": "workshop"}, "invalid_argument") // not declared
	h.fail(admin, "app.trust", map[string]any{"app": "tool", "module": "nope"}, "invalid_argument")
	h.call(admin, "app.trust", map[string]any{"app": "tool", "module": "system"})
	if got := fmtAny(has()); !strings.Contains(got, `"grants"`) || !strings.Contains(got, `"people"`) {
		t.Fatalf("trusted: keys = %s", got)
	}
	mods := h.call(admin, "app.modules", map[string]any{"app": "tool"}).(map[string]any)
	if fmtAny(mods["declared"]) != `["system"]` || len(mods["trusted"].([]any)) != 1 {
		t.Fatalf("app.modules = %v", mods)
	}

	// As the visitor: an admin lists people; a member gets the verb's refusal.
	if n, _ := h.call(admin, "actor.call", map[string]any{"store": "tool", "action": "people"}).(float64); n < 2 {
		t.Fatalf("people as admin = %v", n)
	}
	e := h.fail(mia, "actor.call", map[string]any{"store": "tool", "action": "people"}, "permission_denied")
	if !strings.Contains(e["message"].(string), "people.ls is for admins") {
		t.Fatalf("people as member: %v", e)
	}
	// A token without the admin scope cannot do through the app what it
	// cannot do directly.
	writer := h.tokenFor("admin@example.com", "read", "write")
	mp := h.call(admin, "people.ls", map[string]any{"kind": "user"}).([]any)
	var miaID string
	for _, x := range mp {
		if r := x.(map[string]any); r["email"] == "mia@example.com" {
			miaID = r["id"].(string)
		}
	}
	e = h.fail(writer, "actor.call", map[string]any{"store": "tool", "action": "role", "args": map[string]any{"id": miaID, "role": "admin"}}, "permission_denied")
	if !strings.Contains(e["message"].(string), "admin scope") {
		t.Fatalf("role with a write token: %v", e)
	}
	// The system log names the app.
	h.call(admin, "actor.call", map[string]any{"store": "tool", "action": "grant", "args": map[string]any{"store": "tool", "subject": "@guest", "level": "view"}})
	logs := fmtAny(h.call(admin, "log.system", map[string]any{"limit": 3}))
	if !strings.Contains(logs, "app:tool") || !strings.Contains(logs, "trust tool with system") {
		t.Fatalf("system log = %s", logs)
	}

	h.call(admin, "app.untrust", map[string]any{"app": "tool", "module": "system"})
	if got := has(); got != nil {
		t.Fatalf("untrusted again: use('system') = %v", got)
	}
	h.fail(admin, "app.untrust", map[string]any{"app": "tool", "module": "system"}, "not_found")
}
