package server

import (
	"context"
	"errors"
	"html/template"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// setupBilling builds the Stripe service when the config has a stripe
// block. Without one, only comps exist.
func (s *Server) setupBilling() error {
	c := s.Cfg.Stripe
	if c.SecretKeyFile == "" {
		return nil
	}
	key, err := readSecret(c.SecretKeyFile)
	if err != nil {
		return err
	}
	var hooks []string
	if c.WebhookSecretFile != "" {
		h, err := readSecret(c.WebhookSecretFile)
		if err != nil {
			return err
		}
		hooks = strings.Fields(h) // current and previous, for rotation
	}
	g, err := stripe.NewStripe(key, hooks)
	if err != nil {
		return err
	}
	s.SetBilling(g, strings.HasPrefix(key, "sk_live_") || strings.HasPrefix(key, "rk_live_"))
	return nil
}

// SetBilling installs a billing gateway (the fake one in tests).
func (s *Server) SetBilling(g stripe.Gateway, livemode bool) *stripe.Service {
	svc := stripe.NewService(g, s.Sys, stripe.Config{Livemode: livemode, Deployment: s.Cfg.Hosts.Main})
	svc.OnChange = func(person string) { s.reviewPerson(context.Background(), person) }
	s.billing = svc
	s.Env.Billing = svc
	return svc
}

func (s *Server) billingRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /webhooks/stripe", s.stripeWebhook)
	m.HandleFunc("GET /subscribe", s.subscribePage)
	m.HandleFunc("POST /billing/checkout", s.billingCheckout)
	m.HandleFunc("POST /billing/portal", s.billingPortal)
}

// stripeWebhook stores a verified event for the worker; it is a request to
// refresh, never the truth.
func (s *Server) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	if s.billing == nil {
		http.NotFound(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "unreadable body", http.StatusBadRequest)
		return
	}
	if _, err := s.billing.Ingest(r.Context(), body, r.Header.Get("Stripe-Signature")); err != nil {
		http.Error(w, "rejected", http.StatusBadRequest)
		return
	}
	w.WriteHeader(http.StatusOK)
}

var subscribeTmpl = template.Must(template.New("subscribe").Parse(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Subscribe · slop</title>
{{if .Returning}}<meta http-equiv="refresh" content="3;url=/subscribe">{{end}}
<style>body{font:15px/1.5 Arial,sans-serif;color:#1a1a1a;margin:0;display:grid;place-items:center;min-height:100vh}
main{border:1px solid #d6d6d6;padding:24px 28px;max-width:400px}h1{font-size:18px;margin:0 0 12px}
.dim{color:#737373;font-size:13px}button{margin-top:12px;padding:7px 14px;border:1px solid #1a1a1a;background:#1a1a1a;color:#fff;font:inherit;cursor:pointer}
button.quiet{background:#fff;color:#1a1a1a}.err{color:#e2001a}</style>
<main><h1>{{if .Subscriber}}You are a subscriber{{else}}Subscribe{{end}}</h1>
{{if .Problem}}<p class="err">{{.Problem}}</p>{{end}}
{{if .Returning}}<p>Thank you. Your subscription is being confirmed…</p>{{end}}
{{if .Subscriber}}<p>{{.Reason}}{{if .Until}}, until {{.Until}}{{end}}.</p>{{else}}<p class="dim">Subscribers get more from the apps here.</p>{{end}}
{{if .Stripe}}
  {{if not .Subscriber}}{{range .Prices}}<form method="post" action="/billing/checkout"><input type="hidden" name="csrf" value="{{$.CSRF}}">
  <input type="hidden" name="price" value="{{.}}"><button>Subscribe</button></form>{{end}}{{end}}
  {{if .Customer}}<form method="post" action="/billing/portal"><input type="hidden" name="csrf" value="{{.CSRF}}"><button class="quiet">Manage billing</button></form>{{end}}
{{else}}{{if not .Subscriber}}<p>Subscriptions are given by an admin here: ask one for access.</p>{{end}}{{end}}
</main>`))

// subscribePage is the main host's subscribe page. Coming back from
// Checkout (?checkout=) asks for a refresh, which beats the webhook.
func (s *Server) subscribePage(w http.ResponseWriter, r *http.Request) {
	p, sess, _ := s.principalOf(r)
	if p == nil || sess == nil || p.Kind != access.KindUser {
		http.Redirect(w, r, "/auth/login?return=/subscribe", http.StatusSeeOther)
		return
	}
	ctx := r.Context()
	returning := false
	if cs := r.URL.Query().Get("checkout"); cs != "" && s.billing != nil {
		returning = s.billing.Refresh(ctx, s.billingPerson(p), cs) == nil
		s.billing.Drain(ctx)
	}
	d := s.Env.K.Standing(ctx, p.ID())
	data := map[string]any{"Subscriber": d.Allowed, "Reason": map[string]string{"subscriber": "Through your subscription",
		"subscriber_trial": "On a trial", "complimentary": "Given by an admin"}[d.Reason],
		"Stripe": s.billing != nil, "Prices": s.Cfg.Stripe.Prices, "CSRF": sess.CSRF, "Returning": returning && !d.Allowed,
		"Problem": r.URL.Query().Get("problem")}
	if d.Until != nil {
		data["Until"] = d.Until.Format("2 January 2006")
	}
	if _, err := s.Sys.CustomerFor(ctx, p.ID()); err == nil {
		data["Customer"] = true
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = subscribeTmpl.Execute(w, data)
}

func (s *Server) billingPerson(p *access.Principal) stripe.Person {
	return stripe.Person{ID: p.ID(), Email: p.Person.Email, Name: p.Person.Name}
}

// billingForm checks a signed-in user's form post with its CSRF token.
func (s *Server) billingForm(w http.ResponseWriter, r *http.Request) (*access.Principal, bool) {
	p, sess, _ := s.principalOf(r)
	if s.billing == nil || p == nil || sess == nil || p.Kind != access.KindUser {
		http.Redirect(w, r, "/subscribe", http.StatusSeeOther)
		return nil, false
	}
	if err := r.ParseForm(); err != nil || r.PostForm.Get("csrf") != sess.CSRF {
		http.Error(w, "this form expired; go back and try again", http.StatusForbidden)
		return nil, false
	}
	return p, true
}

func (s *Server) billingCheckout(w http.ResponseWriter, r *http.Request) {
	p, ok := s.billingForm(w, r)
	if !ok {
		return
	}
	u, err := s.Env.Billing.Checkout(r.Context(), s.billingPerson(p), r.PostForm.Get("price"), s.Env.K.Policy().AcceptedPrices, s.Cfg.MainURL()+"/subscribe")
	if errors.Is(err, stripe.ErrSubscriptionOpen) {
		s.billingPortal(w, r)
		return
	}
	if err != nil {
		log.Printf("checkout: %v", err)
		http.Redirect(w, r, "/subscribe?problem=The+checkout+could+not+start", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, u, http.StatusSeeOther)
}

func (s *Server) billingPortal(w http.ResponseWriter, r *http.Request) {
	p, ok := s.billingForm(w, r) // ParseForm is idempotent: checkout may have parsed it
	if !ok {
		return
	}
	u, err := s.billing.Portal(r.Context(), s.billingPerson(p), s.Cfg.MainURL()+"/subscribe")
	if err != nil {
		http.Redirect(w, r, "/subscribe?problem=Billing+management+is+not+available", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, u, http.StatusSeeOther)
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
