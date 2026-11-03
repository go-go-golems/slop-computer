// Package pages is the page door (SLOP3-010 PR 3): live hosts (the shell,
// actor pages and routes, views and their runtime methods, live registry
// documents), static hosts (published sites), sandbox origins (store bytes
// on their own origin), previews and sign-in handoffs. The host builds it
// with New and dispatches the live, static and sandbox hosts to it.
package pages

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/billing"
	capsdb "github.com/go-go-golems/slop-computer/pkg/caps/db"
	caproom "github.com/go-go-golems/slop-computer/pkg/caps/room"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Door serves the live, static and sandbox hosts. The exported fields are
// what the host hands over; New fills in the rest.
type Door struct {
	Cfg      *config.Config
	Sys      *sysdb.DB
	People   *identity.Accounts
	Registry *registry.Registry
	Ledger   *llm.Ledger
	Gov      *policy.Governance
	Book     *billing.Book
	// K and A are the kernel and the actor manager (either may be nil in
	// tests that serve no stores or no actors).
	K *kernel.Kernel
	A *actor.Manager
	// Confirm is the book of governance changes waiting for a person.
	Confirm *verbs.Confirmations
	Web     *web.Sessions
	// Verbs is the table views call through.
	Verbs *verbs.Table
	// Key signs sandbox labels.
	Key []byte
	// CatchUpGap runs between a catch-up's head read and its document
	// read (tests commit there; nil otherwise).
	CatchUpGap func()

	rt *rtState
	// reg serves the registry as documents (pkg/registry); follow is the
	// door's place in the system log (registry.go).
	reg     *registry.Docs
	db      *capsdb.DB
	follow  sysFollower
	samples samples
	rooms   *caproom.Rooms
}

// New fills in d's state, follows the system log and the kernel's commits,
// and returns d.
func New(d *Door) *Door {
	s := d
	s.rt = newRT(s.Key)
	s.rooms = caproom.New(s.rt.views)
	s.rt.views.OnClose = func(v *rt.View, rooms []string) {
		s.rooms.Closed(v, rooms)
		s.reg.Live.Forget(v.ID, "")
	}
	s.reg = &registry.Docs{Verbs: s.Verbs, Host: regHost{s}, Live: registry.NewLive(), Sys: s.Registry, Confirm: s.Confirm}
	if s.K != nil {
		s.reg.Access = s.K.Access
	}
	s.db = &capsdb.DB{K: s.K, Host: dbHost{s}, Reg: dbHost{s}}
	if s.Sys != nil {
		// Views follow the system log: a change of access, a person's role
		// or comps, or an app's policy rechecks the views it may affect,
		// and live registry documents hear what moved (SLOP3-009 step 3).
		s.follow.cursor, _ = s.Sys.LogHead(context.Background())
		s.Sys.Listen(func() { go s.followSystem() })
	}
	if s.K != nil {
		s.K.Subscribe(s.publish)
	}
	return s
}

// InstallActors gives the actor manager the path space of an actor's
// store (aliases, _stores), resolved as its pages' are. Rooms and
// sampling reach actors through the actor door.
func (s *Door) InstallActors(m *actor.Manager) {
	m.Paths = s.db
}

// Rooms is the room capability over the door's open views (the actor door
// serves it to actors).
func (s *Door) Rooms() *caproom.Rooms { return s.rooms }

// MainRoutes registers what the pages serve on the main host: the sign-in
// handoff to a live host.
func (s *Door) MainRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /auth/handoff", s.handoff)
}

// ServeLive serves a live host.
func (s *Door) ServeLive(w http.ResponseWriter, r *http.Request) { s.serveLive(w, r) }

// ServeStatic serves a static host.
func (s *Door) ServeStatic(w http.ResponseWriter, r *http.Request) { s.serveStatic(w, r) }

// ServeSandbox serves a sandbox origin.
func (s *Door) ServeSandbox(w http.ResponseWriter, r *http.Request) { s.serveSandbox(w, r) }

// Tick is the minute's housekeeping: expired views close, and every open
// view is checked again (comps and subscription periods that ended).
func (s *Door) Tick(ctx context.Context, now time.Time) {
	s.rt.views.Sweep(now)
	s.ReviewAll(ctx)
}

// RunMethod runs a runtime method on an open view as viewRPC does once the
// request is read: the method must exist, be granted to the view and clear
// its floor. In-process callers (the db benchmark) use it.
func (s *Door) RunMethod(ctx context.Context, view, method string, args json.RawMessage) (any, error) {
	v := s.rt.views.Get(view)
	if v == nil {
		return nil, &rtFail{Code: "revoked", Message: "the view is closed or expired"}
	}
	m, ok := s.rpcTable()[method]
	if !ok {
		return nil, &rtFail{Code: "capability_removed", Message: "unknown method " + method}
	}
	name, _, _ := strings.Cut(method, ".")
	if _, granted := grantedCaps(v)[name]; !granted && name != "permissions" {
		return nil, &rtFail{Code: "not_granted", Message: "this view was not granted " + name}
	}
	if !viewMay(v, m.act) {
		return nil, &rtFail{Code: "not_granted", Message: method + " needs more access than this view has"}
	}
	return m.fn(ctx, v, args)
}
