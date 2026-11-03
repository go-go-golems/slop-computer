package server

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	billingdoor "github.com/go-go-golems/slop-computer/pkg/doors/billing"
	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// setupBilling builds the Stripe service when the config has a stripe
// block. Without one, only comps exist.
func (s *Server) setupBilling() error {
	g, live, err := billingdoor.Gateway(s.Cfg)
	if err != nil || g == nil {
		return err
	}
	s.SetBilling(g, live)
	return nil
}

// SetBilling installs a billing gateway (the fake one in tests).
func (s *Server) SetBilling(g stripe.Gateway, livemode bool) *stripe.Service {
	svc := stripe.NewService(g, s.Book, stripe.Config{Livemode: livemode, Deployment: s.Cfg.Hosts.Main})
	svc.OnChange = func(person string) { s.reviewPerson(context.Background(), person) }
	s.billing = svc
	s.billingDoor.Service = svc
	s.Env.Billing = svc
	return svc
}

// --- audiences change over time ----------------------------------------------

// reviewPerson re-checks the open views of one person, after their role,
// comps or subscription changed.
func (s *Server) reviewPerson(ctx context.Context, person string) {
	seen := map[string]bool{}
	for _, v := range s.rt.views.Where(func(v *rt.View) bool { return v.User == person }) {
		if !seen[v.Target] {
			seen[v.Target] = true
			s.reviewViews(ctx, v.Target)
		}
	}
}

// reviewAll re-checks every open view: a comp or a subscription period
// that ended demotes its person within one tick.
func (s *Server) reviewAll(ctx context.Context) {
	seen := map[string]bool{}
	for _, v := range s.rt.views.Where(func(*rt.View) bool { return true }) {
		if !seen[v.Target] {
			seen[v.Target] = true
			s.reviewViews(ctx, v.Target)
		}
	}
}
