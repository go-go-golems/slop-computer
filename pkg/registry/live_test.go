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

// A subscription remembered before its snapshot keeps the newer version of
// each document: what the follower sent in between, or the snapshot.
func TestLiveSaw(t *testing.T) {
	l := NewLive()
	l.Remember("v", Sub{ID: "s", Path: "_stores", Coll: true}, nil)
	// the follower ran between registration and the snapshot read
	if changed, _ := l.Update("v", "s", []rt.Doc{{Path: "_stores/a", Version: 7}}); len(changed) != 1 {
		t.Fatalf("first update: %v", changed)
	}
	l.Saw("v", "s", []rt.Doc{{Path: "_stores/a", Version: 5}, {Path: "_stores/b", Version: 3}})
	changed, gone := l.Update("v", "s", []rt.Doc{{Path: "_stores/a", Version: 7}, {Path: "_stores/b", Version: 3}})
	if len(changed) != 0 || len(gone) != 0 {
		t.Fatalf("after Saw: changed %v gone %v", changed, gone)
	}
	l.Saw("v", "nosuch", []rt.Doc{{Path: "x", Version: 1}}) // no subscription: nothing
}
