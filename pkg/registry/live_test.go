package registry

import (
	"reflect"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// Update sends what moved: newer versions, and paths that are gone.
func TestLiveUpdate(t *testing.T) {
	l := NewLive()
	l.Remember("v1", Sub{ID: "s", Path: "_stores/crm/_grants", Coll: true}, []rt.Doc{{Path: "a", Version: 3}, {Path: "b", Version: 5}})
	changed, gone := l.Update("v1", "s", []rt.Doc{{Path: "a", Version: 3}, {Path: "c", Version: 9}})
	if len(changed) != 1 || changed[0].Path != "c" || !reflect.DeepEqual(gone, []string{"b"}) {
		t.Fatalf("changed %v gone %v", changed, gone)
	}
	if changed, gone := l.Update("v1", "s", []rt.Doc{{Path: "a", Version: 4}, {Path: "c", Version: 9}}); len(changed) != 1 || changed[0].Path != "a" || len(gone) != 0 {
		t.Fatalf("second update: %v %v", changed, gone)
	}
	l.Forget("v1", "s")
	if len(l.Views()) != 0 {
		t.Fatal("forgotten subscription still listed")
	}
	if c, g := l.Update("v1", "s", nil); c != nil || g != nil {
		t.Fatal("update of a forgotten subscription")
	}
}
