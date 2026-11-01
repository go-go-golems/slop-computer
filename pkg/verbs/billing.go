package verbs

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/billing/stripe"
	"github.com/go-go-golems/slop/pkg/system"
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
func (e *Env) personArg(ctx context.Context, s string) (system.Person, error) {
	var p system.Person
	var err error
	if strings.Contains(s, "@") {
		p, err = e.Sys.PersonByEmail(ctx, s)
	} else {
		p, err = e.Sys.Person(ctx, s)
	}
	if err != nil {
		return p, Errf("not_found", "no person %s", s)
	}
	return p, nil
}

func (e *Env) personChanged(ctx context.Context, id string) {
	if e.PersonChanged != nil {
		e.PersonChanged(ctx, id)
	}
}

func init() {
	Register(
		&Verb{Name: "sub.grant", Doc: "Give a person complimentary subscriber access until a date (2027-06-30) or for days (30d).", Scope: Admin, AdminOnly: true,
			Args: []Arg{{Name: "person", Type: "string", Pos: 1, Required: true, Doc: "usr_… or an email"},
				{Name: "until", Type: "string", Required: true}, {Name: "note", Type: "string"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				pp, err := e.personArg(ctx, a.S("person"))
				if err != nil {
					return nil, err
				}
				if pp.Kind != "user" {
					return nil, Errf("invalid_argument", "comps are for signed-in people, not guests")
				}
				until, err := parseUntil(a.S("until"))
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				c, err := e.Sys.GrantComp(ctx, p.ID(), p.ViaLabel(), pp.ID, until, a.S("note"))
				if err != nil {
					return nil, err
				}
				e.personChanged(ctx, pp.ID)
				return c, nil
			}},
		&Verb{Name: "sub.revoke", Doc: "End a comp now.", Scope: Admin, AdminOnly: true,
			Args: []Arg{{Name: "id", Type: "string", Pos: 1, Required: true, Doc: "cmp_…"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				person, err := e.Sys.RevokeComp(ctx, p.ID(), p.ViaLabel(), a.S("id"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "no comp %s", a.S("id"))
				}
				if err != nil {
					return nil, err
				}
				e.personChanged(ctx, person)
				return map[string]any{"revoked": a.S("id"), "person": person}, nil
			}},
		&Verb{Name: "sub.ls", Doc: "List comps (of one person, or everyone's).", Scope: Read, AdminOnly: true,
			Args: []Arg{{Name: "person", Type: "string", Pos: 1}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				id := ""
				if a.S("person") != "" {
					pp, err := e.personArg(ctx, a.S("person"))
					if err != nil {
						return nil, err
					}
					id = pp.ID
				}
				return e.Sys.CompRows(ctx, id)
			}},
		&Verb{Name: "sub.show", Doc: "Show a person's standing access (yours by default): the decision, comps and subscriptions.", Scope: Read,
			Args: []Arg{{Name: "person", Type: "string", Pos: 1}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				id := p.ID()
				if s := a.S("person"); s != "" {
					pp, err := e.personArg(ctx, s)
					if err != nil {
						return nil, err
					}
					if pp.ID != p.ID() && !p.IsAdmin() {
						return nil, Errf("permission_denied", "only admins look at other people's access")
					}
					id = pp.ID
				}
				comps, err := e.Sys.CompRows(ctx, id)
				if err != nil {
					return nil, err
				}
				subs, err := e.Sys.Subscriptions(ctx, id)
				if err != nil {
					return nil, err
				}
				pp, _ := e.Sys.Person(ctx, id)
				q := &access.Principal{Kind: access.KindUser, Person: &pp}
				return map[string]any{"person": id, "audience": e.K.Access.AudienceOf(ctx, q), "decision": e.K.Standing(ctx, id),
					"comps": comps, "subscriptions": subs}, nil
			}},
		&Verb{Name: "billing.checkout", Doc: "Start a Stripe Checkout for a subscription price; returns its URL.", Scope: Write,
			Args: []Arg{{Name: "price", Type: "string", Pos: 1, Doc: "a price from the server's stripe.prices (default the first)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if e.Billing == nil {
					return nil, Errf("unavailable", "this server has no Stripe; ask an admin for a comp")
				}
				if p.Kind != access.KindUser && p.Kind != access.KindToken || p.Person == nil || p.Person.Kind != "user" {
					return nil, Errf("permission_denied", "sign in to subscribe")
				}
				price := a.S("price")
				if price == "" && len(e.Cfg.Stripe.Prices) > 0 {
					price = e.Cfg.Stripe.Prices[0]
				}
				if !e.K.Policy().AcceptedPrices[price] {
					return nil, Errf("invalid_argument", "unknown price %q", price)
				}
				u, err := e.Billing.Checkout(ctx, stripe.Person{ID: p.ID(), Email: p.Person.Email, Name: p.Person.Name}, price,
					e.K.Policy().AcceptedPrices, e.Cfg.MainURL()+"/subscribe")
				if errors.Is(err, stripe.ErrSubscriptionOpen) {
					return nil, Errf("conflict", "you already have a subscription: use billing.portal")
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"url": u}, nil
			}},
		&Verb{Name: "billing.portal", Doc: "Open the Stripe Customer Portal for your subscription; returns its URL.", Scope: Write,
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if e.Billing == nil {
					return nil, Errf("unavailable", "this server has no Stripe")
				}
				if p.Person == nil {
					return nil, Errf("permission_denied", "sign in first")
				}
				u, err := e.Billing.Portal(ctx, stripe.Person{ID: p.ID(), Email: p.Person.Email, Name: p.Person.Name}, e.Cfg.MainURL()+"/subscribe")
				if errors.Is(err, stripe.ErrNoCustomer) {
					return nil, Errf("not_found", "no billing account yet")
				}
				if err != nil {
					return nil, err
				}
				return map[string]any{"url": u}, nil
			}},
		&Verb{Name: "billing.refresh", Doc: "Ask Stripe for a person's current subscriptions now (yours, or anyone's for admins).", Scope: Write,
			Args: []Arg{{Name: "person", Type: "string", Pos: 1}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if e.Billing == nil {
					return nil, Errf("unavailable", "this server has no Stripe")
				}
				id := p.ID()
				if s := a.S("person"); s != "" && p.IsAdmin() {
					pp, err := e.personArg(ctx, s)
					if err != nil {
						return nil, err
					}
					id = pp.ID
				}
				if err := e.Billing.ReconcilePerson(ctx, id); err != nil {
					return nil, Errf("not_found", "no billing account for %s", id)
				}
				e.Billing.Drain(ctx)
				return e.K.Standing(ctx, id), nil
			}},
	)
}
