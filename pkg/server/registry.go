package server

// The registry's documents in the page protocol (pkg/registry), and the
// page door's follower of the system log (SLOP3-009 step 3): one pass per
// commit, in order, rechecks the open views a change may affect (what the
// verbs' AccessChanged, PersonChanged and PolicyChanged callbacks did) and
// sends live registry documents what moved.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// regHost is the server as the registry documents' Host.
type regHost struct{ s *Server }

func (h regHost) Viewer(ctx context.Context, v *rt.View) *access.Principal {
	return h.s.viewPrincipal(ctx, v)
}

func (h regHost) ActingApp(ctx context.Context, v *rt.View) *access.Principal {
	if v.User == "" {
		return nil
	}
	return h.s.personAs(ctx, v.User, "app:"+v.App)
}

func (h regHost) Reachable(ctx context.Context, v *rt.View, ceil rt.Level) ([]system.StoreRow, error) {
	return h.s.reachableStores(ctx, v, ceil)
}

func (regHost) WithPrincipal(ctx context.Context, p *access.Principal) context.Context {
	return withPrincipal(ctx, p)
}

// regErr is a registry refusal as the runtime's error.
func regErr(err error) error {
	var e *registry.Error
	if errors.As(err, &e) {
		return &rtFail{Code: e.Code, Message: e.Message, Confirm: e.Confirm}
	}
	return err
}

// sysFollower is the page door's place in the system log.
type sysFollower struct {
	mu     sync.Mutex
	cursor int64
}

// followSystem handles the system log commits since the last pass.
func (s *Server) followSystem() {
	s.follow.mu.Lock()
	defer s.follow.mu.Unlock()
	ctx := context.Background()
	for {
		entries, err := s.Sys.LogAfter(ctx, s.follow.cursor, 200)
		if err != nil || len(entries) == 0 {
			return
		}
		stores, people, apps := map[string]bool{}, map[string]bool{}, map[string]bool{}
		live := false
		for _, e := range entries {
			for _, c := range e.Changes {
				switch c.Kind {
				case "grant", "binding":
					st, _, _ := strings.Cut(c.Key, " ")
					stores[st] = true
				case "store":
					stores[c.Key] = true
				case "link":
					if l, err := s.Sys.LinkByID(ctx, c.Key); err == nil {
						stores[l.Store] = true
					}
				case "person", "comp":
					people[c.Key] = true
				case "policy":
					app, _, _ := strings.Cut(c.Key, " ")
					apps[app] = true
				}
				live = live || registry.Affects(c)
			}
			s.follow.cursor = e.Rev
		}
		for st := range stores {
			s.reviewViews(ctx, st)
		}
		for p := range people {
			s.reviewPerson(ctx, p)
		}
		for a := range apps {
			s.reviewApp(ctx, a)
		}
		if live {
			s.refreshRegistry(ctx, s.follow.cursor)
		}
		if len(entries) < 200 {
			return
		}
	}
}

// refreshRegistry recomputes every live registry subscription and sends
// what moved; a document that is gone is deleted at rev.
func (s *Server) refreshRegistry(ctx context.Context, rev int64) {
	for id, subs := range s.reg.Live.Views() {
		v := s.rt.views.Get(id)
		if v == nil {
			s.reg.Live.Forget(id, "")
			continue
		}
		for _, sub := range subs {
			r, err := s.route(ctx, v, sub.Path, !sub.Coll)
			if err != nil || !r.tgt.Registry {
				continue
			}
			var now []rt.Doc
			if sub.Coll {
				q := sub.Query
				q.Coll = sub.Path
				now = q.Apply(s.reg.Coll(ctx, v, r.tgt, sub.Path))
			} else if d := s.reg.Doc(ctx, v, r.tgt, sub.Path); d != nil {
				now = []rt.Doc{*d}
			}
			changed, gone := s.reg.Live.Update(id, sub.ID, now)
			for _, d := range changed {
				body, _ := json.Marshal(d.Body)
				v.Send(rt.Out{Type: "doc", Data: docOut{Path: d.Path, Version: d.Version, Body: body}})
			}
			for _, p := range gone {
				v.Send(rt.Out{Type: "doc", Data: docOut{Path: p, Version: rev, Deleted: true}})
			}
		}
	}
}
