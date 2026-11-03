package host

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	billingdoor "github.com/go-go-golems/slop-computer/pkg/doors/billing"
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

// SetBilling installs a billing gateway (the fake one in tests): the
// billing door and the commands use it, and a change to a person's
// standing re-checks their open views.
func (s *Server) SetBilling(g stripe.Gateway, livemode bool) *stripe.Service {
	svc := stripe.NewService(g, s.Book, stripe.Config{Livemode: livemode, Deployment: s.Cfg.Hosts.Main})
	svc.OnChange = func(person string) { s.Pages.ReviewPerson(context.Background(), person) }
	s.billing = svc
	s.billingDoor.Service = svc
	s.Env.Billing = svc
	return svc
}
