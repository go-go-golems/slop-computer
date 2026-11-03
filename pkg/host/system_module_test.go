package host

// Tests from SLOP3-002 phase W2 (the system module); formerly w2_test.go.

import (
	"strings"
	"testing"
	"time"
)

const officeActor = `
const system = use('system'), db = use('db');
defineActor({
  actions: {
    // Members may call these; what the module lets them do is the verb's own rule.
    letIn: { requires: 'interact', async run(ctx, { id }) { return await system.people.setRole(id, 'member'); } },
    verb: { requires: 'interact', async run(ctx, { name, args }) { return await system.call(name, args || {}); } },
    mount: { requires: 'interact', async run(ctx, { host, path, store }) { return await system.mounts.set({ host, path, store }); } },
  },
  on: {
    async 'doc:trigger/*'(ctx, c) {
      const stores = (await system.stores.list()).length;
      let code = '';
      try { await system.grants.set('office', '@guest', 'view'); } catch (e) { code = e.code; }
      db.doc('out/reactor').set({ stores, code });
    },
  },
});
`

// W2 exit: as an admin visitor, people.setRole works and the system log
// says via app:<app>; a member gets the verb's own error; a reactor may
// read but not write; call refuses verbs outside the module.
func TestSystemModule(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write", "admin") // all scopes: the role decides
	h.tokenFor("pat@example.com")
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
	patID := idOf("pat@example.com")

	// An admin lets Pat in through the app; the log names the app.
	h.call(admin, "people.role", map[string]any{"id": patID, "role": "pending"})
	letIn := map[string]any{"store": "office", "action": "letIn", "args": map[string]any{"id": patID}}
	e := h.fail(admin, "actor.call", letIn, "confirmation_required") // governance: W6
	h.call(admin, "confirm.approve", map[string]any{"id": e["extra"].(map[string]any)["confirm"]})
	got := h.call(admin, "actor.call", letIn).(map[string]any)
	if got["role"] != "member" {
		t.Fatalf("letIn = %v", got)
	}
	entry := h.call(admin, "log.system", map[string]any{"limit": 1}).([]any)[0].(map[string]any)
	if !strings.HasPrefix(entry["via"].(string), "app:office") || !strings.Contains(fmtAny(entry), "member") {
		t.Fatalf("log entry = %v", entry)
	}
	// A member gets the verb's refusal, as from the CLI.
	e = h.fail(mia, "actor.call", map[string]any{"store": "office", "action": "letIn", "args": map[string]any{"id": patID}}, "permission_denied")
	if !strings.Contains(e["message"].(string), "people.role is for admins") {
		t.Fatalf("letIn as member: %v", e)
	}
	// call: the back office's generic path; only the module's verbs.
	if rows := h.call(admin, "actor.call", map[string]any{"store": "office", "action": "verb", "args": map[string]any{"name": "grant.ls", "args": map[string]any{"store": "office"}}}).([]any); len(rows) == 0 {
		t.Fatalf("call grant.ls = %v", rows)
	}
	for _, v := range []string{"token.new", "app.trust", "files.push", "sql.exec"} {
		e = h.fail(admin, "actor.call", map[string]any{"store": "office", "action": "verb", "args": map[string]any{"name": v, "args": map[string]any{}}}, "permission_denied")
		if !strings.Contains(e["message"].(string), "not in the system module") {
			t.Fatalf("call %s: %v", v, e)
		}
	}
	// One object argument is the argument object.
	m := h.call(admin, "actor.call", map[string]any{"store": "office", "action": "mount", "args": map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/office", "store": "office"}}).(map[string]any)
	if m["mount"].(map[string]any)["store"] != "office" {
		t.Fatalf("mounts.set = %v", m)
	}

	// A reactor reads (as the store's owner) and may not write.
	h.call(admin, "docs.set", map[string]any{"store": "office", "path": "trigger/1", "data": map[string]any{}})
	var out map[string]any
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(50 * time.Millisecond) {
		st, r := api(t, h, admin, "docs.get", map[string]any{"store": "office", "path": "out/reactor"})
		if st == 200 && r["result"] != nil {
			out = r["result"].(map[string]any)["body"].(map[string]any)
			break
		}
	}
	if out == nil || out["code"] != "permission_denied" || out["stores"].(float64) < 1 {
		t.Fatalf("reactor: %v", out)
	}
}
