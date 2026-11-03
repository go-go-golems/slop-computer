// Package billing is the subscription door: the Stripe webhook, the main
// host's subscribe page, and the checkout and portal forms (SLOP3-010 PR 3).
// The host builds the stripe.Service and hands it over.
package billing

import (
	"github.com/go-go-golems/slop-computer/pkg/billing"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/kernel"
)

// Door serves /webhooks/stripe, /subscribe and /billing/*.
type Door struct {
	Cfg  *config.Config
	Web  *web.Sessions
	Book *billing.Book
	// K answers standing (Standing) and the accepted prices (Policy).
	K *kernel.Kernel
	// Service is the Stripe service; nil without a stripe block (comps only).
	Service *stripe.Service
}
