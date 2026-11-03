package pages

import (
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// Every runtime method declares an action on its view's store; viewRPC
// checks the floor before the method runs.
func TestEveryRPCDeclaresAnAction(t *testing.T) {
	s := &Door{}
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
