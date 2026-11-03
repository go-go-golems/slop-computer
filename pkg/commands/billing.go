package commands

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// parseUntil reads a date (2027-06-30, end of that day UTC), a duration in
// days (30d), or milliseconds.
func parseUntil(s string) (int64, error) {
	s = strings.TrimSpace(s)
	if strings.HasSuffix(s, "d") {
		n, err := strconv.Atoi(strings.TrimSuffix(s, "d"))
		if err != nil || n <= 0 {
			return 0, errors.New("days must be a positive number, as in 30d")
		}
		return time.Now().Add(time.Duration(n) * 24 * time.Hour).UnixMilli(), nil
	}
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t.Add(24*time.Hour - time.Millisecond).UnixMilli(), nil
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return n, nil
	}
	return 0, errors.New("until is a date (2027-06-30), days (30d) or milliseconds")
}

// personArg resolves a person by id or email.
func (e kernelEnv) personArg(ctx context.Context, s string) (sysdb.Person, error) {
	var p sysdb.Person
	var err error
	if strings.Contains(s, "@") {
		p, err = e.K.People.PersonByEmail(ctx, s)
	} else {
		p, err = e.K.People.Person(ctx, s)
	}
	if err != nil {
		return p, verbs.Errf("not_found", "no person %s", s)
	}
	return p, nil
}

func billingVerbs(e billingEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[SubGrantIn, any]{Name: "sub.grant", Effect: verbs.EffectGovern, Doc: "Give a person complimentary subscriber access until a date (2027-06-30) or for days (30d).", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in SubGrantIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				pp, err := e.personArg(ctx, in.Person)
				if err != nil {
					return nil, err
				}
				if pp.Kind != "user" {
					return nil, verbs.Errf("invalid_argument", "comps are for signed-in people, not guests")
				}
				until, err := parseUntil(in.Until)
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				c, err := e.K.Book.GrantComp(ctx, p.ID(), p.ViaLabel(), pp.ID, until, in.Note)
				if err != nil {
					return nil, err
				}
				return c, nil
			}}.Verb(),
		verbs.Def[SubRevokeIn, any]{Name: "sub.revoke", Effect: verbs.EffectGovern, Doc: "End a comp now.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in SubRevokeIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				person, err := e.K.Book.RevokeComp(ctx, p.ID(), p.ViaLabel(), in.ID)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no comp %s", in.ID)
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"revoked": in.ID, "person": person}, nil
			}}.Verb(),
		verbs.Def[SubLsIn, any]{Name: "sub.ls", Doc: "List comps (of one person, or everyone's).", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in SubLsIn) (any, error) {
				ctx := req.Context
				id := ""
				if in.Person != "" {
					pp, err := e.personArg(ctx, in.Person)
					if err != nil {
						return nil, err
					}
					id = pp.ID
				}
				return e.K.Book.CompRows(ctx, id)
			}}.Verb(),
		verbs.Def[SubShowIn, any]{Name: "sub.show", Doc: "Show a person's standing access (yours by default): the decision, comps and subscriptions.", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in SubShowIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				id := p.ID()
				if s := in.Person; s != "" {
					pp, err := e.personArg(ctx, s)
					if err != nil {
						return nil, err
					}
					if pp.ID != p.ID() && !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins look at other people's access")
					}
					id = pp.ID
				}
				comps, err := e.K.Book.CompRows(ctx, id)
				if err != nil {
					return nil, err
				}
				subs, err := e.K.Book.Subscriptions(ctx, id)
				if err != nil {
					return nil, err
				}
				pp, _ := e.K.People.Person(ctx, id)
				q := access.PersonPrincipal(pp, "")
				return map[string]any{"person": id, "audience": e.K.Access.AudienceOf(ctx, q), "decision": e.K.Standing(ctx, id),
					"comps": comps, "subscriptions": subs}, nil
			}}.Verb(),
		verbs.Def[BillingCheckoutIn, any]{Name: "billing.checkout", Doc: "Start a Stripe Checkout for a subscription price; returns its URL.", Scope: verbs.Write, Action: authz.Account,
			Run: func(req verbs.Req, in BillingCheckoutIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if e.Billing() == nil {
					return nil, verbs.Errf("unavailable", "this server has no Stripe; ask an admin for a comp")
				}
				if p.Kind != access.KindUser && p.Kind != access.KindToken || p.Person == nil || p.Person.Kind != "user" {
					return nil, verbs.Errf("permission_denied", "sign in to subscribe")
				}
				price := in.Price
				if price == "" && len(e.Cfg.Stripe.Prices) > 0 {
					price = e.Cfg.Stripe.Prices[0]
				}
				if !e.K.Policy().AcceptedPrices[price] {
					return nil, verbs.Errf("invalid_argument", "unknown price %q", price)
				}
				u, err := e.Billing().Checkout(ctx, stripe.Person{ID: p.ID(), Email: p.Person.Email, Name: p.Person.Name}, price,
					e.K.Policy().AcceptedPrices, e.Cfg.MainURL()+"/subscribe")
				if errors.Is(err, stripe.ErrSubscriptionOpen) {
					return nil, verbs.Errf("conflict", "you already have a subscription: use billing.portal")
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"url": u}, nil
			}}.Verb(),
		verbs.Def[BillingPortalIn, any]{Name: "billing.portal", Doc: "Open the Stripe Customer Portal for your subscription; returns its URL.", Scope: verbs.Write, Action: authz.Account,
			Run: func(req verbs.Req, in BillingPortalIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if e.Billing() == nil {
					return nil, verbs.Errf("unavailable", "this server has no Stripe")
				}
				if p.Person == nil {
					return nil, verbs.Errf("permission_denied", "sign in first")
				}
				u, err := e.Billing().Portal(ctx, stripe.Person{ID: p.ID(), Email: p.Person.Email, Name: p.Person.Name}, e.Cfg.MainURL()+"/subscribe")
				if errors.Is(err, stripe.ErrNoCustomer) {
					return nil, verbs.Errf("not_found", "no billing account yet")
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"url": u}, nil
			}}.Verb(),
		verbs.Def[BillingRefreshIn, any]{Name: "billing.refresh", Doc: "Ask Stripe for a person's current subscriptions now (yours, or anyone's for admins).", Scope: verbs.Write, Action: authz.Account,
			Run: func(req verbs.Req, in BillingRefreshIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				if e.Billing() == nil {
					return nil, verbs.Errf("unavailable", "this server has no Stripe")
				}
				id := p.ID()
				if s := in.Person; s != "" && p.IsAdmin() {
					pp, err := e.personArg(ctx, s)
					if err != nil {
						return nil, err
					}
					id = pp.ID
				}
				if err := e.Billing().ReconcilePerson(ctx, id); err != nil {
					return nil, verbs.Errf("not_found", "no billing account for %s", id)
				}
				e.Billing().Drain(ctx)
				return e.K.Standing(ctx, id), nil
			}}.Verb(),
	}
}

// SubGrantIn is sub.grant's input.
type SubGrantIn struct {
	Person string `json:"person" slop:"pos=1" jsonschema_description:"usr_… or an email"`
	Until  string `json:"until"`
	Note   string `json:"note,omitempty"`
}

// SubRevokeIn is sub.revoke's input.
type SubRevokeIn struct {
	ID string `json:"id" slop:"pos=1" jsonschema_description:"cmp_…"`
}

// SubLsIn is sub.ls's input.
type SubLsIn struct {
	Person string `json:"person,omitempty" slop:"pos=1"`
}

// SubShowIn is sub.show's input.
type SubShowIn struct {
	Person string `json:"person,omitempty" slop:"pos=1"`
}

// BillingCheckoutIn is billing.checkout's input.
type BillingCheckoutIn struct {
	Price string `json:"price,omitempty" slop:"pos=1" jsonschema_description:"a price from the server's stripe.prices (default the first)"`
}

// BillingPortalIn is billing.portal's input.
type BillingPortalIn struct {
}

// BillingRefreshIn is billing.refresh's input.
type BillingRefreshIn struct {
	Person string `json:"person,omitempty" slop:"pos=1"`
}
