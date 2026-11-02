package server

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/apps"
)

const toolActor = `
const system = use('system');
defineActor({
  actions: {
    has(ctx) { return system ? Object.keys(system).sort() : null; },
    // Members may call these; what the module lets them do is the verb's own rule.
    people: { requires: 'interact', async run(ctx) { return (await system.people.list({ kind: 'user' })).length; } },
    role: { requires: 'interact', async run(ctx, { id, role }) { return await system.people.setRole(id, role); } },
    grant: { requires: 'interact', async run(ctx, { store, subject, level }) { return await system.grants.set(store, subject, level); } },
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
	// The system log names the app. (The activation row can land among the
	// last few: whichever caller runs Running first activates and logs, and
	// a background caller may log after the test's own calls; so look at
	// the last ten rows, not three.)
	h.call(admin, "actor.call", map[string]any{"store": "tool", "action": "grant", "args": map[string]any{"store": "tool", "subject": "@guest", "level": "view"}})
	logs := fmtAny(h.call(admin, "log.system", map[string]any{"limit": 10}))
	if !strings.Contains(logs, "app:tool") || !strings.Contains(logs, "trust tool with system") {
		t.Fatalf("system log = %s", logs)
	}

	h.call(admin, "app.untrust", map[string]any{"app": "tool", "module": "system"})
	if got := has(); got != nil {
		t.Fatalf("untrusted again: use('system') = %v", got)
	}
	h.fail(admin, "app.untrust", map[string]any{"app": "tool", "module": "system"}, "not_found")
}

// Calls queued behind a busy turn when the actor stops (a new version, a
// restart) never ran: they go to the actor that replaces it instead of
// failing with "the actor stopped".
func TestCallsSurviveActorRestart(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "busy"})
	h.call(admin, "files.push", map[string]any{"store": "busy", "files": files(map[string]string{
		"app.json": `{"title":"Busy","actor":"actor.js"}`,
		"actor.js": `
defineActor({
  actions: {
    spin(ctx, { n }) { let x = 0; for (let i = 0; i < n; i++) x += i; return x; },
    ping(ctx) { return 'pong'; },
  },
});`,
		"index.html": "<!doctype html><title>busy</title>",
	})})
	h.call(admin, "actor.call", map[string]any{"store": "busy", "action": "ping"}) // build the actor
	owner := actor.Visitor{ID: "store:busy", Level: "owner"}
	// spin holds the turn for a while (the test clock does not move, so it
	// counts instead of waiting)
	start := time.Now()
	if _, err := h.srv.Env.A.Call(context.Background(), "busy", "spin", map[string]any{"n": 200000}, owner, "test"); err != nil {
		t.Fatal(err)
	}
	n0 := int(200000 * float64(400*time.Millisecond) / float64(time.Since(start)+1))
	go func() {
		_, _ = h.srv.Env.A.Call(context.Background(), "busy", "spin", map[string]any{"n": n0}, owner, "test")
	}()
	time.Sleep(50 * time.Millisecond)
	const n = 6
	errs := make(chan error, n)
	for range n {
		go func() {
			v, err := h.srv.Env.A.Call(context.Background(), "busy", "ping", nil, owner, "test")
			if err == nil && v != "pong" {
				err = fmt.Errorf("ping = %v", v)
			}
			errs <- err
		}()
	}
	time.Sleep(50 * time.Millisecond) // the pings are queued behind spin
	h.srv.Env.A.Restart("busy")
	for range n {
		if err := <-errs; err != nil {
			t.Fatalf("a call queued when the actor stopped: %v", err)
		}
	}
}

// The queue belongs to the store: calls queued when the actor restarts run
// once each, in the order they were queued, on the actor that replaces it.
func TestQueuedCallsRunOnceInOrder(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "line"})
	h.call(admin, "files.push", map[string]any{"store": "line", "files": files(map[string]string{
		"app.json": `{"title":"Line","actor":"actor.js"}`,
		"actor.js": `
const db = use('db');
defineActor({
  actions: {
    spin(ctx, { n }) { let x = 0; for (let i = 0; i < n; i++) x += i; return x; },
    add(ctx, { i }) {
      const d = db.doc('line/main'), cur = d.get();
      const seen = cur.exists ? cur.data().seen : [];
      seen.push(i);
      d.set({ seen });
      return seen.length;
    },
  },
});`,
		"index.html": "<!doctype html><title>line</title>",
	})})
	owner := actor.Visitor{ID: "store:line", Level: "owner"}
	call := func(action string, args map[string]any) (any, error) {
		return h.srv.Env.A.Call(context.Background(), "line", action, args, owner, "test")
	}
	start := time.Now()
	if _, err := call("spin", map[string]any{"n": 200000}); err != nil {
		t.Fatal(err)
	}
	n0 := int(200000 * float64(400*time.Millisecond) / float64(time.Since(start)+1))
	go func() { _, _ = call("spin", map[string]any{"n": n0}) }()
	time.Sleep(50 * time.Millisecond)
	const n = 5
	errs := make(chan error, n)
	for i := range n {
		go func() { _, err := call("add", map[string]any{"i": i}); errs <- err }()
		time.Sleep(10 * time.Millisecond) // queued in this order
	}
	h.srv.Env.A.Restart("line")
	for range n {
		if err := <-errs; err != nil {
			t.Fatalf("a call queued when the actor stopped: %v", err)
		}
	}
	doc := h.call(admin, "docs.get", map[string]any{"store": "line", "path": "line/main"}).(map[string]any)
	body, _ := doc["body"].(map[string]any)
	if got := fmt.Sprint(body["seen"]); got != "[0 1 2 3 4]" {
		t.Fatalf("calls ran as %s, want each once in order", got)
	}
}

// An actor (acting as its store, never an admin) cannot write app code:
// D9 is enforced by the store, not by the verbs that used to check it.
func TestActorsCannotWriteAppCode(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "maker"})
	h.call(admin, "files.push", map[string]any{"store": "maker", "files": files(map[string]string{
		"app.json": `{"title":"Maker","actor":"actor.js"}`,
		"actor.js": `
const files = use('files');
defineActor({
  actions: {
    note(ctx) { files.write('notes.txt', 'hi'); return 'ok'; },
    plant(ctx, { path }) { files.write(path, '{}', { zone: 'tree' }); return 'planted'; },
  },
});`,
		"index.html": "<!doctype html><title>maker</title>",
	})})
	owner := actor.Visitor{ID: "store:maker", Level: "owner"}
	call := func(action string, args map[string]any) (any, error) {
		return h.srv.Env.A.Call(context.Background(), "maker", action, args, owner, "test")
	}
	if v, err := call("note", nil); err != nil || v != "ok" {
		t.Fatalf("an asset write: %v %v", v, err)
	}
	for _, path := range []string{"app.json", "actor.js", "index.html"} {
		_, err := call("plant", map[string]any{"path": path})
		var ae *actor.Error
		if !errors.As(err, &ae) || ae.Code != "permission_denied" {
			t.Fatalf("an actor writing %s into its app's tree: %v", path, err)
		}
	}
}
