package billing

import (
	"errors"
	"html/template"
	"io"
	"log"
	"net/http"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
)

// Routes registers the Stripe webhook, the subscribe page and the billing
// forms.
func (s *Door) Routes(m *http.ServeMux) {
	m.HandleFunc("POST /webhooks/stripe", s.stripeWebhook)
	m.HandleFunc("GET /subscribe", s.subscribePage)
	m.HandleFunc("POST /billing/checkout", s.billingCheckout)
	m.HandleFunc("POST /billing/portal", s.billingPortal)
}

// stripeWebhook stores a verified event for the worker; it is a request to
// refresh, never the truth.
func (s *Door) stripeWebhook(w http.ResponseWriter, r *http.Request) {
	if s.Service == nil {
		http.NotFound(w, r)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "unreadable body", http.StatusBadRequest)
		return
	}
	if _, err := s.Service.Ingest(r.Context(), body, r.Header.Get("Stripe-Signature")); err != nil {
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
func (s *Door) subscribePage(w http.ResponseWriter, r *http.Request) {
	p, sess, _ := s.Web.Principal(r)
	if p == nil || sess == nil || p.Kind != access.KindUser {
		http.Redirect(w, r, "/auth/login?return=/subscribe", http.StatusSeeOther)
		return
	}
	ctx := r.Context()
	returning := false
	if cs := r.URL.Query().Get("checkout"); cs != "" && s.Service != nil {
		returning = s.Service.Refresh(ctx, s.billingPerson(p), cs) == nil
		s.Service.Drain(ctx)
	}
	d := s.K.Standing(ctx, p.ID())
	data := map[string]any{"Subscriber": d.Allowed, "Reason": map[string]string{"subscriber": "Through your subscription",
		"subscriber_trial": "On a trial", "complimentary": "Given by an admin"}[d.Reason],
		"Stripe": s.Service != nil, "Prices": s.Cfg.Stripe.Prices, "CSRF": sess.CSRF, "Returning": returning && !d.Allowed,
		"Problem": r.URL.Query().Get("problem")}
	if d.Until != nil {
		data["Until"] = d.Until.Format("2 January 2006")
	}
	if _, err := s.Book.CustomerFor(ctx, p.ID()); err == nil {
		data["Customer"] = true
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = subscribeTmpl.Execute(w, data)
}

func (s *Door) billingPerson(p *access.Principal) stripe.Person {
	return stripe.Person{ID: p.ID(), Email: p.Person.Email, Name: p.Person.Name}
}

// billingForm checks a signed-in user's form post with its CSRF token.
func (s *Door) billingForm(w http.ResponseWriter, r *http.Request) (*access.Principal, bool) {
	p, sess, _ := s.Web.Principal(r)
	if s.Service == nil || p == nil || sess == nil || p.Kind != access.KindUser {
		http.Redirect(w, r, "/subscribe", http.StatusSeeOther)
		return nil, false
	}
	if err := r.ParseForm(); err != nil || r.PostForm.Get("csrf") != sess.CSRF {
		http.Error(w, "this form expired; go back and try again", http.StatusForbidden)
		return nil, false
	}
	return p, true
}

func (s *Door) billingCheckout(w http.ResponseWriter, r *http.Request) {
	p, ok := s.billingForm(w, r)
	if !ok {
		return
	}
	u, err := s.Service.Checkout(r.Context(), s.billingPerson(p), r.PostForm.Get("price"), s.K.Policy().AcceptedPrices, s.Cfg.MainURL()+"/subscribe")
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

func (s *Door) billingPortal(w http.ResponseWriter, r *http.Request) {
	p, ok := s.billingForm(w, r) // ParseForm is idempotent: checkout may have parsed it
	if !ok {
		return
	}
	u, err := s.Service.Portal(r.Context(), s.billingPerson(p), s.Cfg.MainURL()+"/subscribe")
	if err != nil {
		http.Redirect(w, r, "/subscribe?problem=Billing+management+is+not+available", http.StatusSeeOther)
		return
	}
	http.Redirect(w, r, u, http.StatusSeeOther)
}
