package room

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// view opens a view of store at level with its stream attached, in the
// unnamed room.
func view(reg *rt.Registry, store string, level rt.Level) (*rt.View, <-chan rt.Out) {
	v := reg.Open(&rt.View{Target: store, Level: level})
	v.Join("")
	return v, v.Attach()
}

// next is the next event on ch of type typ (others are skipped), or fails.
func next(t *testing.T, ch <-chan rt.Out, typ string) rt.Out {
	t.Helper()
	for {
		select {
		case o := <-ch:
			if o.Type == typ {
				return o
			}
		default:
			t.Fatalf("no %s event", typ)
		}
	}
}

func code(err error) string {
	var e *Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func TestJoinLeaveAndPeers(t *testing.T) {
	reg := rt.NewRegistry()
	r := New(reg)
	a, ach := view(reg, "club", rt.LevelView)
	b, _ := view(reg, "club", rt.LevelView)
	if _, err := r.Join(a, "Bad Name"); code(err) != "invalid_argument" {
		t.Fatalf("a bad room name: %v", err)
	}
	if _, err := r.Join(a, "chess"); err != nil {
		t.Fatal(err)
	}
	peers, err := r.Join(b, "chess")
	if err != nil {
		t.Fatal(err)
	}
	if n := len(peers["peers"].([]rt.Peer)); n != 2 {
		t.Fatalf("chess has %d peers, want 2", n)
	}
	if got := r.Of(a); strings.Join(got, ",") != ",chess" {
		t.Fatalf("a is in %q", got)
	}
	next(t, ach, "peers") // a hears b arrive
	r.Leave(b, "chess")
	if n := len(r.Peers("club", "chess")["peers"].([]rt.Peer)); n != 1 {
		t.Fatalf("chess has %d peers after b left, want 1", n)
	}
	r.Closed(a, r.Of(a))
	if got := r.Of(b); strings.Join(got, ",") != "" {
		t.Fatalf("b is in %q", got)
	}
}

func TestJoinStopsAtTheLimit(t *testing.T) {
	reg := rt.NewRegistry()
	r := New(reg)
	v, _ := view(reg, "club", rt.LevelView)
	var err error
	for i := 0; i <= rt.MaxRooms+1 && err == nil; i++ {
		_, err = r.Join(v, "r"+strings.Repeat("x", i))
	}
	if code(err) != "limit_reached" {
		t.Fatalf("joining past %d rooms: %v", rt.MaxRooms, err)
	}
}

func TestEmit(t *testing.T) {
	reg := rt.NewRegistry()
	r := New(reg)
	viewer, vch := view(reg, "club", rt.LevelView)
	admin, _ := view(reg, "club", rt.LevelAdmin)
	now := time.Now()
	for _, c := range []struct {
		v           *rt.View
		room, topic string
		data        string
		want        string
	}{
		{admin, "", "Bad", "1", "invalid_argument"},
		{admin, "", "move", strings.Repeat("1", rt.MaxRoomData+1), "invalid_argument"},
		{viewer, "", "move", "1", "not_permitted"}, // topics need admin unless the manifest opens them
		{admin, "elsewhere", "move", "1", "invalid_argument"},
	} {
		if _, err := r.Emit(c.v, c.room, c.topic, json.RawMessage(c.data), now); code(err) != c.want {
			t.Errorf("emit %q on %q: %v, want %s", c.topic, c.room, err, c.want)
		}
	}
	viewer.Caps.Topics = map[string]rt.Level{"move": rt.LevelView}
	if dropped, err := r.Emit(viewer, "", "move", json.RawMessage(`{"x":1}`), now); err != nil || dropped {
		t.Fatalf("an opened topic: dropped %v, %v", dropped, err)
	}
	ev := next(t, vch, "room").Data.(map[string]any)
	if ev["topic"] != "move" || ev["peer"] != viewer.ID || string(ev["data"].(json.RawMessage)) != `{"x":1}` {
		t.Fatalf("room event %v", ev)
	}
}

func TestEmitFromStore(t *testing.T) {
	reg := rt.NewRegistry()
	r := New(reg)
	v, ch := view(reg, "club", rt.LevelView)
	_, other := view(reg, "elsewhere", rt.LevelView)
	r.EmitFromStore("club", "changed", map[string]any{"id": 7})
	ev := next(t, ch, "room").Data.(map[string]any)
	if ev["by"] != "store:club" || ev["kind"] != "actor" || string(ev["data"].(json.RawMessage)) != `{"id":7}` {
		t.Fatalf("store event %v", ev)
	}
	select {
	case o := <-other:
		t.Fatalf("another store's view heard %v", o)
	default:
	}
	if peers := r.StorePeers("club"); len(peers) != 1 || peers[0].Peer != v.ID {
		t.Fatalf("store peers %v", peers)
	}
}
