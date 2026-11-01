package rt

import (
	"crypto/rand"
	"encoding/base32"
	"encoding/json"
	"strings"
	"sync"
	"time"
)

// SecretPrefix marks view secrets: the bearer a page's runtime calls with.
const SecretPrefix = "slv_"

// View lifetimes: a secret lives ViewTTL and the shell renews it; a view
// whose stream never connects is dropped after ConnectGrace, one whose
// stream went away after IdleGrace (a reload opens a new view anyway).
const (
	ViewTTL      = time.Hour
	ConnectGrace = 15 * time.Second
	IdleGrace    = 2 * time.Minute
)

// View is one open page (or agent) on a target: who, at which level, with
// which capabilities. It lives in memory only; a server restart ends every
// view and the shell opens new ones.
type View struct {
	ID      string    `json:"view"`
	Secret  string    `json:"-"`
	Target  string    `json:"target"`
	App     string    `json:"app"`
	Version int       `json:"version"`
	User    string    `json:"user"`
	Name    string    `json:"-"`
	Role    string    `json:"-"` // the viewer's role: admin, member (visitor later); policy beyond levels
	Level   Level     `json:"-"`
	Caps    Caps      `json:"-"`
	Perms   []string  `json:"permissions"` // approved slop permissions
	Kind    string    `json:"kind"`        // viewer | agent
	Expires time.Time `json:"expiresAt"`
	Created time.Time `json:"-"`

	mu    sync.Mutex
	ch    chan Out
	idle  time.Time // when the last stream ended (zero: one is attached or none ever was)
	subs  map[string]Sub
	rooms map[string]*Member
	emits bucket
}

// Out is something a view's stream sends: a target change it filters by
// its subscriptions, or an event it sends as is.
type Out struct {
	Change *Change
	Type   string
	Data   any
}

// Change is a committed document write. Patch is set when it is small next
// to the body (diff sync); Body is nil for a delete.
type Change struct {
	Rev     int64           `json:"rev"`
	Path    string          `json:"path"`
	Version int64           `json:"version"`
	Body    json.RawMessage `json:"body,omitempty"`
	Patch   *Patch          `json:"patch,omitempty"`
	Base    int64           `json:"base,omitempty"`
	Deleted bool            `json:"deleted,omitempty"`
}

// Sub is one db subscription of a view: a document, or a collection whose
// changes all reach the view (the runtime evaluates filters and limits).
type Sub struct {
	ID   string `json:"sub"`
	Path string `json:"path"`
	Coll bool   `json:"coll"`
}

// Covers reports whether a change at doc path p reaches this subscription.
func (s Sub) Covers(p string) bool {
	if s.Coll {
		return CollOf(p) == s.Path
	}
	return s.Path == p
}

// Member is a view's presence in one room.
type Member struct {
	Presence map[string]any
	At       int64 // unix ms of the last change
}

// Peer is a room member as pages see it (isMe and sameTab are the runtime's).
type Peer struct {
	Peer      string         `json:"peer"`
	By        *string        `json:"by"`
	Kind      string         `json:"kind"`
	Guest     bool           `json:"guest"`
	Presence  map[string]any `json:"presence"`
	UpdatedAt int64          `json:"updatedAt"`
}

// Attach starts a stream: a new channel replaces (and closes) an older
// stream's.
func (v *View) Attach() <-chan Out {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.ch != nil {
		close(v.ch)
	}
	v.ch = make(chan Out, 512)
	v.idle = time.Time{}
	return v.ch
}

// Detach ends the stream that owns ch.
func (v *View) Detach(ch <-chan Out) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.ch != nil && (<-chan Out)(v.ch) == ch {
		close(v.ch)
		v.ch = nil
		v.idle = time.Now()
	}
}

// Send queues o on the view's stream. A full queue ends the stream: the
// runtime reconnects and catches up from the table.
func (v *View) Send(o Out) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.ch == nil {
		return
	}
	select {
	case v.ch <- o:
	default:
		close(v.ch)
		v.ch = nil
		v.idle = time.Now()
	}
}

// Subscribe registers a subscription; false past MaxSubscriptions.
func (v *View) Subscribe(s Sub) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.subs[s.ID]; !ok && len(v.subs) >= MaxSubscriptions {
		return false
	}
	v.subs[s.ID] = s
	return true
}

func (v *View) Unsubscribe(id string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	delete(v.subs, id)
}

// Wants reports whether a change at path reaches the view.
func (v *View) Wants(path string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	for _, s := range v.subs {
		if s.Covers(path) {
			return true
		}
	}
	return false
}

// Subs lists the view's subscriptions.
func (v *View) Subs() []Sub {
	v.mu.Lock()
	defer v.mu.Unlock()
	out := make([]Sub, 0, len(v.subs))
	for _, s := range v.subs {
		out = append(out, s)
	}
	return out
}

// AllowEmit takes one token of the emit budget (40 a second, burst 80).
func (v *View) AllowEmit(now time.Time) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.emits.take(now, 40, 80)
}

type bucket struct {
	tokens float64
	at     time.Time
}

func (b *bucket) take(now time.Time, rate, burst float64) bool {
	if b.at.IsZero() {
		b.tokens = burst
	} else {
		b.tokens = min(burst, b.tokens+now.Sub(b.at).Seconds()*rate)
	}
	b.at = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// Registry holds the open views.
type Registry struct {
	mu       sync.Mutex
	byID     map[string]*View
	bySecret map[string]*View
	// OnClose runs (outside the lock) for every view that closes, with the
	// rooms it was in, so the server can tell the remaining peers.
	OnClose func(v *View, rooms []string)
}

func NewRegistry() *Registry {
	return &Registry{byID: map[string]*View{}, bySecret: map[string]*View{}}
}

func token(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return strings.ToLower(strings.TrimRight(base32.StdEncoding.EncodeToString(b), "="))
}

// Open registers v with a fresh id and secret.
func (r *Registry) Open(v *View) *View {
	now := time.Now()
	v.ID, v.Secret = "v"+token(10), SecretPrefix+token(20)
	v.Created, v.Expires = now, now.Add(ViewTTL)
	v.subs, v.rooms = map[string]Sub{}, map[string]*Member{}
	r.mu.Lock()
	r.byID[v.ID], r.bySecret[v.Secret] = v, v
	r.mu.Unlock()
	return v
}

// Lookup finds a live view by its secret.
func (r *Registry) Lookup(secret string) *View {
	r.mu.Lock()
	defer r.mu.Unlock()
	v := r.bySecret[secret]
	if v == nil || time.Now().After(v.Expires) {
		return nil
	}
	return v
}

// Get finds a view by id.
func (r *Registry) Get(id string) *View {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.byID[id]
}

// Renew extends a view's secret.
func (r *Registry) Renew(v *View) {
	r.mu.Lock()
	v.Expires = time.Now().Add(ViewTTL)
	r.mu.Unlock()
}

// Of lists the views of a target.
func (r *Registry) Of(target string) []*View {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*View
	for _, v := range r.byID {
		if v.Target == target {
			out = append(out, v)
		}
	}
	return out
}

// Where lists the views matching fn.
func (r *Registry) Where(fn func(*View) bool) []*View {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*View
	for _, v := range r.byID {
		if fn(v) {
			out = append(out, v)
		}
	}
	return out
}

// Close ends a view: revoked tells its stream why.
func (r *Registry) Close(v *View, revoked bool) {
	r.mu.Lock()
	_, ok := r.byID[v.ID]
	delete(r.byID, v.ID)
	delete(r.bySecret, v.Secret)
	r.mu.Unlock()
	if !ok {
		return
	}
	if revoked {
		v.Send(Out{Type: "revoked", Data: map[string]any{}})
	}
	v.mu.Lock()
	rooms := make([]string, 0, len(v.rooms))
	for name := range v.rooms {
		rooms = append(rooms, name)
	}
	v.rooms = map[string]*Member{}
	v.mu.Unlock()
	if r.OnClose != nil {
		r.OnClose(v, rooms)
	}
}

// Sweep closes views that expired, never connected, or lost their stream
// a while ago.
func (r *Registry) Sweep(now time.Time) {
	var dead []*View
	r.mu.Lock()
	for _, v := range r.byID {
		v.mu.Lock()
		stale := now.After(v.Expires) ||
			(v.ch == nil && v.idle.IsZero() && now.Sub(v.Created) > ConnectGrace) ||
			(v.ch == nil && !v.idle.IsZero() && now.Sub(v.idle) > IdleGrace)
		v.mu.Unlock()
		if stale {
			dead = append(dead, v)
		}
	}
	r.mu.Unlock()
	for _, v := range dead {
		r.Close(v, false)
	}
}

// Join puts v in a room ("" is the lobby); false past MaxRooms.
func (v *View) Join(room string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.rooms[room]; ok {
		return true
	}
	if room != "" && len(v.rooms) > MaxRooms {
		return false
	}
	v.rooms[room] = &Member{Presence: map[string]any{}, At: time.Now().UnixMilli()}
	return true
}

// Leave takes v out of a room; false when it was not in it.
func (v *View) Leave(room string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	_, ok := v.rooms[room]
	delete(v.rooms, room)
	return ok
}

// In reports whether v is in a room.
func (v *View) In(room string) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	_, ok := v.rooms[room]
	return ok
}

// SetPresence merges a patch (null removes a field) into v's presence in a
// room and checks the 4 KiB bound of the merged object.
func (v *View) SetPresence(room string, patch map[string]any) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	m, ok := v.rooms[room]
	if !ok {
		return errNotInRoom
	}
	next := make(map[string]any, len(m.Presence)+len(patch))
	for k, x := range m.Presence {
		next[k] = x
	}
	for k, x := range patch {
		if x == nil {
			delete(next, k)
		} else {
			next[k] = x
		}
	}
	raw, err := json.Marshal(next)
	if err != nil || len(raw) > MaxPresence || Depth(next) > 8 {
		return errPresence
	}
	if string(raw) != string(canon(m.Presence)) {
		m.Presence, m.At = next, time.Now().UnixMilli()
	}
	return nil
}

// AsPeer is v as a member of room, or false when it is not in it.
func (v *View) AsPeer(room string) (Peer, bool) {
	v.mu.Lock()
	defer v.mu.Unlock()
	m, ok := v.rooms[room]
	if !ok {
		return Peer{}, false
	}
	// Guest: an anonymous visitor (store.VisitorPrefix; rt does not import store).
	p := Peer{Peer: v.ID, Kind: v.Kind, Guest: strings.HasPrefix(v.User, "vis_"), Presence: m.Presence, UpdatedAt: m.At}
	if v.Caps.Declared["user"] && v.User != "" {
		by := v.User
		p.By = &by
	}
	return p, true
}

type rtError string

func (e rtError) Error() string { return string(e) }

const (
	errNotInRoom = rtError("not in this room")
	errPresence  = rtError("presence is a JSON object of at most 4 KiB and 8 levels")
)
