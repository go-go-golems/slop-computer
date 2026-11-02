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
			Run: func(context.Context, *verbs.Env, *access.Principal, verbs.Args) (any, error) { return "ran", nil }})
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
