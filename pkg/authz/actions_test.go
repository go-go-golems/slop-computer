package authz

import (
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

func TestFloor(t *testing.T) {
	levels := []rt.Level{rt.LevelNone, rt.LevelView, rt.LevelInteract, rt.LevelAdmin, rt.LevelOwner}
	for act, spec := range Specs {
		for _, l := range levels {
			for _, admin := range []bool{false, true} {
				want := (!spec.Admin || admin) && (!spec.Store || l >= spec.Level)
				if ok, why := Floor(act, l, admin); ok != want || (ok == (why != "")) {
					t.Errorf("Floor(%s, %s, admin=%v) = %v %q, want %v", act, l, admin, ok, why, want)
				}
			}
		}
	}
	for _, c := range []struct {
		act   Action
		level rt.Level
		admin bool
		ok    bool
	}{
		{CodePush, rt.LevelOwner, false, false}, // D9: owning a store is not enough
		{CodePush, rt.LevelAdmin, true, true},
		{AssetWrite, rt.LevelView, false, false},
		{DocWrite, rt.LevelView, false, true}, // the db rules decide further
		{PlatformAdmin, rt.LevelNone, true, true},
		{"made.up", rt.LevelOwner, true, false},
	} {
		if ok, _ := Floor(c.act, c.level, c.admin); ok != c.ok {
			t.Errorf("Floor(%s, %s, admin=%v) = %v", c.act, c.level, c.admin, ok)
		}
	}
}
