// Package room is the room capability (SLOP3-010 PR 4): the rooms of a
// store's open views, who is in them (peers and their presence), and
// messages to them. The page door serves it to views (room.join, leave,
// presence, emit) and the actor door to actors (room.emit, room.peers);
// both call this one implementation.
//
// A room belongs to a store: the views of that store are its possible
// peers. Every view is in the unnamed room ""; it may join up to
// rt.MaxRooms named ones.
package room

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/rt"
)

var (
	// TopicName is what an emit's topic must match.
	TopicName = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,47}$`)
	// RoomName is what a named room must match.
	RoomName = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,47}$`)
)

// Error is a refusal, with a code the page runtime understands.
type Error struct{ Code, Message string }

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func errf(code, format string, args ...any) error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// Rooms holds the named rooms each open view joined. Membership itself
// (and presence) is on the view; Rooms keeps the index from a view to its
// named rooms and does the announcing.
type Rooms struct {
	views *rt.Registry

	mu     sync.Mutex
	joined map[string][]string // view → named rooms
}

// New makes the rooms of the views in views.
func New(views *rt.Registry) *Rooms {
	return &Rooms{views: views, joined: map[string][]string{}}
}

// Of lists the rooms v is in: "" and the named rooms it joined.
func (r *Rooms) Of(v *rt.View) []string {
	r.mu.Lock()
	names := append([]string{""}, r.joined[v.ID]...)
	r.mu.Unlock()
	var out []string
	for _, name := range names {
		if v.In(name) {
			out = append(out, name)
		}
	}
	return out
}

// Peers is the peers event of a room of target: {room, peers}, sorted.
func (r *Rooms) Peers(target, room string) map[string]any {
	peers := []rt.Peer{}
	for _, o := range r.views.Of(target) {
		if p, ok := o.AsPeer(room); ok {
			peers = append(peers, p)
		}
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Peer < peers[j].Peer })
	return map[string]any{"room": room, "peers": peers}
}

// StorePeers lists the peers in a store's unnamed room (what an actor's
// room.peers() sees).
func (r *Rooms) StorePeers(store string) []rt.Peer {
	out := []rt.Peer{}
	for _, v := range r.views.Of(store) {
		if p, ok := v.AsPeer(""); ok {
			out = append(out, p)
		}
	}
	return out
}

// Announce tells everyone in a room of target who is there now.
func (r *Rooms) Announce(target, room string) {
	ev := rt.Out{Type: "peers", Data: r.Peers(target, room)}
	for _, o := range r.views.Of(target) {
		if o.In(room) {
			o.Send(ev)
		}
	}
}

// AnnounceAll tells every room v is in who is there now (v arrived or
// left: its stream attached or detached).
func (r *Rooms) AnnounceAll(v *rt.View) {
	for _, room := range r.Of(v) {
		r.Announce(v.Target, room)
	}
}

// Closed forgets a closed view and tells the rooms it was in.
func (r *Rooms) Closed(v *rt.View, rooms []string) {
	r.mu.Lock()
	delete(r.joined, v.ID)
	r.mu.Unlock()
	for _, room := range rooms {
		r.Announce(v.Target, room)
	}
}

// Join puts v in a room and returns the room's peers.
func (r *Rooms) Join(v *rt.View, room string) (map[string]any, error) {
	if room != "" && !RoomName.MatchString(room) {
		return nil, errf("invalid_argument", "a room name matches %s", RoomName)
	}
	if !v.Join(room) {
		return nil, errf("limit_reached", "at most %d rooms", rt.MaxRooms)
	}
	if room != "" {
		r.mu.Lock()
		if !slices.Contains(r.joined[v.ID], room) {
			r.joined[v.ID] = append(r.joined[v.ID], room)
		}
		r.mu.Unlock()
	}
	r.Announce(v.Target, room)
	return r.Peers(v.Target, room), nil
}

// Leave takes v out of a room.
func (r *Rooms) Leave(v *rt.View, room string) {
	if v.Leave(room) {
		r.mu.Lock()
		r.joined[v.ID] = slices.DeleteFunc(r.joined[v.ID], func(n string) bool { return n == room })
		r.mu.Unlock()
		r.Announce(v.Target, room)
	}
}

// Presence sets v's presence in a room (joining it if needed).
func (r *Rooms) Presence(v *rt.View, room string, patch map[string]any) error {
	if !v.In(room) {
		v.Join(room)
	}
	if err := v.SetPresence(room, patch); err != nil {
		return errf("invalid_argument", "%v", err)
	}
	r.Announce(v.Target, room)
	return nil
}

// Emit sends v's message on a topic to everyone in a room. A topic needs
// admin unless the app's manifest opens it to a lower level; true means
// the message was dropped (v is over its rate).
func (r *Rooms) Emit(v *rt.View, room, topic string, data json.RawMessage, now time.Time) (bool, error) {
	if !TopicName.MatchString(topic) {
		return false, errf("invalid_argument", "a topic matches %s", TopicName)
	}
	if len(data) > rt.MaxRoomData {
		return false, errf("invalid_argument", "data is at most %d bytes of JSON", rt.MaxRoomData)
	}
	need := rt.LevelAdmin
	if l, ok := v.Caps.Topics[topic]; ok {
		need = l
	}
	if v.Level < need {
		return false, errf("not_permitted", "topic %q needs %s", topic, need)
	}
	if !v.In(room) {
		return false, errf("invalid_argument", "not in room %q", room)
	}
	if !v.AllowEmit(now) {
		return true, nil
	}
	var by *string
	if v.Caps.Declared["user"] && v.User != "" {
		u := v.User
		by = &u
	}
	if len(data) == 0 {
		data = json.RawMessage("null")
	}
	r.send(v.Target, room, rt.Out{Type: "room", Data: map[string]any{"room": room, "topic": topic, "data": data, "peer": v.ID, "by": by,
		"kind": v.Kind, "guest": strings.HasPrefix(v.User, "vis_")}})
	return false, nil
}

// EmitFromStore sends a store's own message (an actor's, after its turn
// committed) to everyone in the store's unnamed room.
func (r *Rooms) EmitFromStore(store, topic string, data any) {
	raw, _ := json.Marshal(data)
	r.send(store, "", rt.Out{Type: "room", Data: map[string]any{"room": "", "topic": topic, "data": json.RawMessage(raw), "peer": "actor",
		"by": "store:" + store, "kind": "actor", "guest": false}})
}

func (r *Rooms) send(target, room string, ev rt.Out) {
	for _, o := range r.views.Of(target) {
		if o.In(room) {
			o.Send(ev)
		}
	}
}
