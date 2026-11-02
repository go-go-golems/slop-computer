package server

import (
	"context"
	"sync"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Every runtime method declares an action on its view's store; viewRPC
// checks the floor before the method runs.
func TestEveryRPCDeclaresAnAction(t *testing.T) {
	s := &Server{}
	for name, m := range s.rpcTable() {
		spec, ok := authz.Of(m.act)
		if !ok || !spec.Store {
			t.Errorf("%s: %q is not an action on a store", name, m.act)
		}
	}
	viewer := &rt.View{Level: rt.LevelView, Role: "member"}
	if viewMay(viewer, authz.AssetWrite) || viewMay(viewer, authz.CodePush) {
		t.Fatal("a viewer clears the floor of uploads or code pushes")
	}
	owner := &rt.View{Level: rt.LevelOwner, Role: "member"}
	if viewMay(owner, authz.CodePush) {
		t.Fatal("an owner who is not an admin pushes app code (D9)")
	}
	if !viewMay(&rt.View{Level: rt.LevelAdmin, Role: "admin"}, authz.CodePush) {
		t.Fatal("an admin cannot push app code")
	}
}

var registerForgetful sync.Once

// The floor holds even for a verb whose Run checks nothing: Call opens the
// declared store at the declared level first.
func TestCallChecksTheFloor(t *testing.T) {
	registerForgetful.Do(func() {
		verbs.Register(&verbs.Verb{Name: "test.forgetful", Scope: verbs.Read, Action: authz.StoreAdmin,
			Args: []verbs.Arg{{Name: "store", Type: "string", Pos: 1}},
			Run:  func(context.Context, *verbs.Env, *access.Principal, verbs.Args) (any, error) { return "ran", nil }})
	})
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "vault"})
	mia := h.tokenFor("mia@example.com", "read", "write")
	h.fail(mia, "test.forgetful", map[string]any{"store": "vault"}, "not_found")
	h.call(admin, "grant.set", map[string]any{"store": "vault", "subject": "@member", "level": "interact"})
	h.fail(mia, "test.forgetful", map[string]any{"store": "vault"}, "permission_denied")
	if out := h.call(admin, "test.forgetful", map[string]any{"store": "vault"}); out != "ran" {
		t.Fatalf("an admin: %v", out)
	}
}

// explain.can answers for an action with the same floor the dispatchers use.
func TestExplainAction(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "plain"})
	h.call(admin, "grant.set", map[string]any{"store": "plain", "subject": "@member", "level": "interact"})
	mia := h.tokenFor("mia@example.com", "read", "write")
	ask := func(token, act string) map[string]any {
		return h.call(token, "explain.can", map[string]any{"store": "plain", "action": act}).(map[string]any)
	}
	if out := ask(mia, "doc.write"); out["ok"] != true {
		t.Fatalf("a member's doc.write: %v", out)
	}
	if out := ask(mia, "store.admin"); out["ok"] != false || out["code"] != "permission_denied" {
		t.Fatalf("a member's store.admin: %v", out)
	}
	if out := ask(admin, "code.push"); out["ok"] != true {
		t.Fatalf("an admin's code.push: %v", out)
	}
}

// Admin power needs an admin token: without the admin scope an admin's
// token acts as a member (no admin-only verbs, no admin level on others'
// stores, no app code). The scope is the token's ceiling on the role.
func TestAdminPowerNeedsTheAdminScope(t *testing.T) {
	h := newHarness(t)
	full := h.tokenFor("admin@example.com", "read", "write", "admin")
	read := h.tokenFor("admin@example.com", "read")
	write := h.tokenFor("admin@example.com", "read", "write")
	mia := h.tokenFor("mia@example.com", "read", "write")
	h.call(mia, "store.new", map[string]any{"id": "mias"})
	h.call(full, "store.new", map[string]any{"id": "app"})

	for _, tok := range []string{read, write} {
		h.fail(tok, "people.ls", map[string]any{}, "permission_denied")
		h.fail(tok, "secret.ls", map[string]any{}, "permission_denied")
		h.fail(tok, "log.system", map[string]any{}, "permission_denied")
		h.fail(tok, "grant.ls", map[string]any{"store": "mias"}, "not_found") // no admin level on a stranger's store
	}
	h.fail(write, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/x", "store": "mias"}, "permission_denied")
	h.fail(write, "files.push", map[string]any{"store": "app", "files": files(map[string]string{"app.json": `{"title":"A"}`, "index.html": "x"})}, "permission_denied")

	h.call(full, "people.ls", map[string]any{})
	h.call(full, "grant.ls", map[string]any{"store": "mias"})
	h.call(full, "files.push", map[string]any{"store": "app", "files": files(map[string]string{"app.json": `{"title":"A"}`, "index.html": "x"})})
}

// A read token holds its person's levels and cannot change anything: an
// owner's read token exports the store and lists its grants, and every
// verb that writes refuses it.
func TestReadTokensReadAtTheirLevel(t *testing.T) {
	h := newHarness(t)
	mia := h.tokenFor("mia@example.com", "read", "write")
	ro := h.tokenFor("mia@example.com", "read")
	h.call(mia, "store.new", map[string]any{"id": "mine"})
	h.call(mia, "docs.set", map[string]any{"store": "mine", "path": "notes/a", "data": map[string]any{"n": 1}})
	h.call(ro, "store.export", map[string]any{"id": "mine"})
	h.call(ro, "grant.ls", map[string]any{"store": "mine"})
	h.call(ro, "docs.get", map[string]any{"store": "mine", "path": "notes/a"})
	for verb, args := range map[string]map[string]any{
		"docs.set":  {"store": "mine", "path": "notes/b", "data": map[string]any{"n": 2}},
		"grant.set": {"store": "mine", "subject": "@member", "level": "view"},
		"files.put": {"store": "mine", "path": "x.txt", "text": "x"},
		"store.rm":  {"id": "mine"},
	} {
		h.fail(ro, verb, args, "permission_denied")
	}
}
