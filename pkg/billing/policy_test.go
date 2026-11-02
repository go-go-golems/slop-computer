package billing

import (
	"testing"
	"time"
)

func TestAccessPolicy(t *testing.T) {
	now := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	future, past := now.Add(24*time.Hour), now.Add(-time.Hour)
	p := Policy{AcceptedPrices: map[string]bool{"price_ok": true}}
	sub := func(id, status string, until *time.Time) Subscription {
		return Subscription{ID: id, PriceID: "price_ok", Status: status, Quantity: 1, ItemCount: 1, AccessUntil: until}
	}
	cases := []struct {
		name    string
		account Account
		subs    []Subscription
		comps   []Comp
		allowed bool
		reason  string
		policy  *Policy
	}{
		{"none", Account{}, nil, nil, false, ReasonRequired, nil},
		{"active", Account{}, []Subscription{sub("a", "active", &future)}, nil, true, ReasonSubscriber, nil},
		{"active period over", Account{}, []Subscription{sub("a", "active", &past)}, nil, false, ReasonExpired, nil},
		{"disabled overrides", Account{Disabled: true}, []Subscription{sub("a", "active", &future)}, nil, false, ReasonDisabled, nil},
		{"past due denied", Account{}, []Subscription{sub("a", "past_due", &future)}, nil, false, ReasonPastDue, nil},
		{"incomplete denied", Account{}, []Subscription{sub("a", "incomplete", &future)}, nil, false, ReasonIncomplete, nil},
		{"unpaid denied", Account{}, []Subscription{sub("a", "unpaid", &future)}, nil, false, ReasonRequired, nil},
		{"canceled denied", Account{}, []Subscription{sub("a", "canceled", &future)}, nil, false, ReasonRequired, nil},
		{"unknown price", Account{}, []Subscription{{ID: "x", PriceID: "price_other", Status: "active", Quantity: 1, ItemCount: 1, AccessUntil: &future}}, nil, false, ReasonRequired, nil},
		{"quantity two", Account{}, []Subscription{{ID: "x", PriceID: "price_ok", Status: "active", Quantity: 2, ItemCount: 1, AccessUntil: &future}}, nil, false, ReasonRequired, nil},
		{"unknown status", Account{}, []Subscription{sub("a", "mystery", &future)}, nil, false, ReasonRequired, nil},
		{"trial disabled", Account{}, []Subscription{{ID: "t", PriceID: "price_ok", Status: "trialing", Quantity: 1, ItemCount: 1, TrialUntil: &future}}, nil, false, ReasonRequired, nil},
		{"trial enabled", Account{}, []Subscription{{ID: "t", PriceID: "price_ok", Status: "trialing", Quantity: 1, ItemCount: 1, TrialUntil: &future}}, nil, true, ReasonTrial, &Policy{AcceptedPrices: map[string]bool{"price_ok": true}, TrialAllowed: true}},
		{"replacement wins over canceled old", Account{}, []Subscription{sub("old", "canceled", &past), sub("new", "active", &future)}, nil, true, ReasonSubscriber, nil},
		{"conflict", Account{}, []Subscription{sub("a", "active", &future), sub("b", "active", &future)}, nil, false, ReasonConflict, nil},
		{"complimentary", Account{}, nil, []Comp{{Until: future}}, true, ReasonComplimentary, nil},
		{"complimentary expired", Account{}, nil, []Comp{{Until: past}}, false, ReasonRequired, nil},
		{"complimentary revoked", Account{}, nil, []Comp{{Until: future, Revoked: true}}, false, ReasonRequired, nil},
		{"complimentary covers past due", Account{}, []Subscription{sub("a", "past_due", &future)}, []Comp{{Until: future}}, true, ReasonComplimentary, nil},
		{"complimentary not for disabled", Account{Disabled: true}, nil, []Comp{{Until: future}}, false, ReasonDisabled, nil},
	}
	for _, c := range cases {
		pol := p
		if c.policy != nil {
			pol = *c.policy
		}
		d := pol.Access(c.account, c.subs, c.comps, now)
		if d.Allowed != c.allowed || d.Reason != c.reason {
			t.Errorf("%s: got allowed=%v reason=%s, want %v %s", c.name, d.Allowed, d.Reason, c.allowed, c.reason)
		}
	}
}

// The decision names what grants access, so the catalog can map it to a plan.
func TestDecisionNamesPriceAndPlan(t *testing.T) {
	now := time.Now()
	future := now.Add(time.Hour)
	p := Policy{AcceptedPrices: map[string]bool{"price_a": true, "price_b": true}}
	d := p.Access(Account{}, []Subscription{{ID: "s", PriceID: "price_b", Status: "active", Quantity: 1, ItemCount: 1, AccessUntil: &future}}, nil, now)
	if !d.Allowed || d.PriceID != "price_b" {
		t.Fatalf("subscription decision %+v", d)
	}
	d = p.Access(Account{}, nil, []Comp{{Until: future, Plan: "friends"}}, now)
	if !d.Allowed || d.Plan != "friends" || d.Reason != ReasonComplimentary {
		t.Fatalf("grant decision %+v", d)
	}
}
