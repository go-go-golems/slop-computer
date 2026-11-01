package kernel

import (
	"context"
	"time"

	"github.com/go-go-golems/slop/pkg/billing"
	"github.com/go-go-golems/slop/pkg/system"
)

// Policy is francois's access policy with this server's accepted prices.
func (k *Kernel) Policy() billing.Policy {
	p := billing.Policy{AcceptedPrices: map[string]bool{}, TrialAllowed: k.Cfg.Stripe.Trials}
	for _, id := range k.Cfg.Stripe.Prices {
		p.AcceptedPrices[id] = true
	}
	return p
}

// Standing decides a person's standing access now: a comp or a Stripe
// subscription makes a member a subscriber (guide §7.4).
func (k *Kernel) Standing(ctx context.Context, person string) billing.Decision {
	p, err := k.Sys.Person(ctx, person)
	if err != nil || p.Kind != "user" {
		return billing.Decision{Reason: billing.ReasonRequired}
	}
	subs, err := k.Sys.Subscriptions(ctx, person)
	if err != nil {
		return billing.Decision{Reason: billing.ReasonRequired}
	}
	comps, err := k.Sys.Comps(ctx, person)
	if err != nil {
		return billing.Decision{Reason: billing.ReasonRequired}
	}
	return k.Policy().Access(billing.Account{Disabled: p.Role == system.RoleDisabled}, subs, comps, time.Now())
}
