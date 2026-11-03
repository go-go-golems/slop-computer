package commands

import (
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/authz"
)

// Every verb declares what it does, so its access floor is in one table
// and Call checks it before Run.
func TestEveryVerbDeclaresAnAction(t *testing.T) {
	counts := map[authz.Action]int{}
	for _, v := range listed().All() {
		spec, ok := authz.Of(v.Action)
		if !ok {
			t.Errorf("%s declares no action (%q)", v.Name, v.Action)
			continue
		}
		counts[v.Action]++
		if spec.Admin && !v.AdminOnly {
			t.Errorf("%s: %s is for admins; mark the verb AdminOnly so help and the API say so", v.Name, v.Action)
		}
		switch {
		case !spec.Store && v.StoreArg != "":
			t.Errorf("%s: %s is on no store, yet names a store argument", v.Name, v.Action)
		case spec.Store && v.StoreArg != "-":
			arg := v.StoreArg
			if arg == "" {
				arg = "store"
			}
			found := false
			for _, a := range v.Args {
				found = found || a.Name == arg
			}
			if !found {
				t.Errorf("%s: %s is on the store in %q, which is not an argument", v.Name, v.Action, arg)
			}
		}
	}
	t.Logf("verbs by action: %v", counts)
}
