// Package billing decides standing access (the subscriber audience) from
// projected Stripe subscriptions and complimentary grants.
//
// Copied from github.com/go-go-golems/francois@106776a
// pkg/catalog/billing/policy.go, with its table tests; Access is unchanged.
// francois's one-off and enterprise support payments are left out.
package billing

import "time"

// Subscription is the projection of one Stripe subscription.
type Subscription struct {
	SupportAmountCents int64      `json:"supportAmountCents"`
	SupportTier        string     `json:"supportTier,omitempty"` // "" or TierEnterprise
	StartedAt          *time.Time `json:"startedAt,omitempty"`
	ID                 string     `json:"id"`
	CustomerID         string     `json:"customerId"`
	PriceID            string     `json:"priceId"`
	Status             string     `json:"status"`
	Quantity           int        `json:"quantity"`
	ItemCount          int        `json:"itemCount"`
	AccessUntil        *time.Time `json:"accessUntil,omitempty"`
	TrialUntil         *time.Time `json:"trialUntil,omitempty"`
	CancelAtPeriodEnd  bool       `json:"cancelAtPeriodEnd"`
	CanceledAt         *time.Time `json:"canceledAt,omitempty"`
	RefreshedAt        time.Time  `json:"refreshedAt"`
}

// Comp is an administrator-granted complimentary access window.
type Comp struct {
	Until   time.Time
	Revoked bool
	// Plan is the granted plan's key; empty means the highest plan.
	Plan string
}

type Account struct {
	Disabled bool
}

type Policy struct {
	// AcceptedPrices are server-configured recurring Price IDs.
	AcceptedPrices map[string]bool
	// TrialAllowed enables access while trialing; no trial is offered by default.
	TrialAllowed bool
}

type Decision struct {
	Allowed bool       `json:"allowed"`
	Reason  string     `json:"reason"`
	Until   *time.Time `json:"until,omitempty"`
	Status  string     `json:"status,omitempty"`
	// CancelScheduled is true when access ends at Until without renewal.
	CancelScheduled bool `json:"cancelScheduled"`
	// PriceID is the price of the standing subscription that grants access.
	PriceID string `json:"priceId,omitempty"`
	// Plan is the plan key of the complimentary grant that grants access.
	Plan string `json:"plan,omitempty"`
}

// Stable reason codes.
const (
	ReasonSubscriber    = "subscriber"
	ReasonTrial         = "subscriber_trial"
	ReasonComplimentary = "complimentary"
	ReasonDisabled      = "account_disabled"
	ReasonConflict      = "billing_conflict"
	ReasonPastDue       = "payment_past_due"
	ReasonIncomplete    = "payment_incomplete"
	ReasonRequired      = "subscription_required"
	ReasonExpired       = "subscription_expired"
)

var standing = map[string]bool{"active": true, "trialing": true, "past_due": true, "unpaid": true, "paused": true}

// Access decides whether an account has paid or granted access now, and
// through which price or grant. It is pure and table-tested; the catalog's
// entitlement resolver maps the decision to a plan.
func (p Policy) Access(a Account, subs []Subscription, comps []Comp, now time.Time) Decision {
	if a.Disabled {
		return Decision{Reason: ReasonDisabled}
	}
	eligible := []Subscription{}
	incomplete := false
	for _, s := range subs {
		if (!p.AcceptedPrices[s.PriceID] && s.SupportAmountCents <= 0) || s.Quantity != 1 || s.ItemCount != 1 {
			continue
		}
		if s.Status == "incomplete" {
			incomplete = true
		}
		if standing[s.Status] {
			eligible = append(eligible, s)
		}
	}
	var best *Decision
	for _, c := range comps {
		if !c.Revoked && now.Before(c.Until) {
			until := c.Until
			if best == nil || until.After(*best.Until) {
				best = &Decision{Allowed: true, Reason: ReasonComplimentary, Until: &until, Plan: c.Plan}
			}
		}
	}
	if len(eligible) > 1 {
		if best != nil {
			return *best
		}
		return Decision{Reason: ReasonConflict}
	}
	if len(eligible) == 1 {
		s := eligible[0]
		d := Decision{Status: s.Status, CancelScheduled: s.CancelAtPeriodEnd, PriceID: s.PriceID}
		switch {
		case s.Status == "active" && s.AccessUntil != nil && now.Before(*s.AccessUntil):
			d.Allowed, d.Reason, d.Until = true, ReasonSubscriber, s.AccessUntil
		case s.Status == "trialing" && p.TrialAllowed && s.TrialUntil != nil && now.Before(*s.TrialUntil):
			d.Allowed, d.Reason, d.Until = true, ReasonTrial, s.TrialUntil
		case s.Status == "active":
			d.Reason = ReasonExpired
		case s.Status == "past_due":
			d.Reason = ReasonPastDue
		default:
			d.Reason = ReasonRequired
		}
		if d.Allowed || best == nil {
			return d
		}
		best.Status = s.Status
		return *best
	}
	if best != nil {
		return *best
	}
	if incomplete {
		return Decision{Reason: ReasonIncomplete, Status: "incomplete"}
	}
	return Decision{Reason: ReasonRequired}
}

// OpenStatus reports subscription states that must go to billing management
// rather than a second Checkout.
func OpenStatus(status string) bool {
	return standing[status] || status == "incomplete"
}
