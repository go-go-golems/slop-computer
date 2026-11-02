package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/billing"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/config"
)

// stream follows a view's event stream and hands over each event.
type stream struct {
	ch   chan map[string]any
	resp *http.Response
}

func openStream(t *testing.T, s *site, v map[string]any) *stream {
	t.Helper()
	u := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	resp, _ := s.do("GET", u, "/_rt/events", nil, map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	st := &stream{ch: make(chan map[string]any, 64), resp: resp}
	go func() {
		defer close(st.ch)
		sc := bufio.NewScanner(resp.Body)
		typ := ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				typ = line[7:]
			case strings.HasPrefix(line, "data: "):
				d := map[string]any{}
				_ = json.Unmarshal([]byte(line[6:]), &d)
				d["_type"] = typ
				st.ch <- d
			}
		}
	}()
	t.Cleanup(func() { resp.Body.Close() })
	return st
}

// next waits for the first event of type typ.
func (st *stream) next(t *testing.T, typ string, timeout time.Duration) map[string]any {
	t.Helper()
	deadline := time.After(timeout)
	for {
		select {
		case d, ok := <-st.ch:
			if !ok {
				t.Fatalf("stream ended waiting for %s", typ)
			}
			if d["_type"] == typ {
				return d
			}
		case <-deadline:
			t.Fatalf("no %s event within %s", typ, timeout)
		}
	}
}

// page is what the shell does for one member: it keeps a view open, and
// on an access event it opens a new view at the new level and closes the
// old one.
type page struct {
	t    *testing.T
	s    *site
	host string
	v    map[string]any
	ev   *stream
}

func newPage(t *testing.T, s *site, host string, v map[string]any) *page {
	pg := &page{t: t, s: s, host: host, v: v, ev: openStream(t, s, v)}
	pg.ev.next(t, "hello", 2*time.Second)
	return pg
}

// expect waits for an access event to level, then reopens like the shell.
func (pg *page) expect(level string, timeout time.Duration) {
	pg.t.Helper()
	if got := pg.ev.next(pg.t, "access", timeout); got["level"] != level {
		pg.t.Fatalf("access event = %v, want %s", got, level)
	}
	st, v := openView(pg.s, pg.host, "/club", "")
	if st != 200 || v["level"] != level {
		pg.t.Fatalf("reopen: %d %v, want %s", st, v, level)
	}
	pg.s.do("DELETE", pg.host, "/_site/views/"+pg.v["view"].(string), nil, nil)
	pg.v = v
	pg.ev = openStream(pg.t, pg.s, v)
	pg.ev.next(pg.t, "hello", 2*time.Second)
}

// clubSite is a store members may view and subscribers may edit, and a
// member signed in on its live host with an open view.
func clubSite(t *testing.T, h *harness, email string) (*site, map[string]any, string) {
	t.Helper()
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "club"})
	h.call(admin, "files.push", map[string]any{"store": "club", "files": files(map[string]string{
		"app.json": `{"title":"Club","capabilities":{"db":{}}}`, "index.html": "<!doctype html><title>c</title>"})})
	h.call(admin, "grant.set", map[string]any{"store": "club", "subject": "@member", "level": "view"})
	h.call(admin, "grant.set", map[string]any{"store": "club", "subject": "@subscriber", "level": "interact"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/club", "store": "club"})
	b := h.browser()
	b.signIn(email)
	s := h.site(live)
	signInSite(t, h, s, b, live, "/club")
	st, v := openView(s, live, "/club", "")
	if st != 200 || v["level"] != "view" {
		t.Fatalf("member view: %d %v", st, v)
	}
	_, me := s.do("GET", live, "/_site/me", nil, nil)
	return s, v, me["id"].(string)
}

// P5 exit: a comp makes a member a subscriber at once, and their open
// view is told to reopen; an expired comp demotes them on the next review
// tick (each minute).
func TestCompsMakeSubscribers(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	s, v, me := clubSite(t, h, "rita@example.com")
	pg := newPage(t, s, h.cfg.Hosts.Live[0], v)

	c := h.call(admin, "sub.grant", map[string]any{"person": "rita@example.com", "until": "30d", "note": "beta tester"}).(map[string]any)
	pg.expect("interact", 2*time.Second)
	show := h.call(admin, "sub.show", map[string]any{"person": me}).(map[string]any)
	if show["audience"] != "subscriber" || show["decision"].(map[string]any)["reason"] != "complimentary" {
		t.Fatalf("sub.show = %v", show)
	}
	// Revoking demotes at once.
	h.call(admin, "sub.revoke", map[string]any{"id": c["id"]})
	pg.expect("view", 2*time.Second)

	// A comp that runs out: a second later, the review tick demotes.
	until := time.Now().Add(time.Second).UnixMilli()
	h.call(admin, "sub.grant", map[string]any{"person": me, "until": jsonInt(until)})
	pg.expect("interact", 2*time.Second)
	time.Sleep(1200 * time.Millisecond)
	h.srv.reviewAll(context.Background()) // what the minute ticker runs
	pg.expect("view", 2*time.Second)
	if e := h.call(admin, "explain.can", map[string]any{"store": "club", "subject": me}).(map[string]any); e["audience"] != "member" {
		t.Fatalf("after expiry: %v", e)
	}
	// A review with nothing changed sends nothing.
	h.srv.reviewAll(context.Background())
	select {
	case d := <-pg.ev.ch:
		if d["_type"] == "access" {
			t.Fatalf("a quiet review sent %v", d)
		}
	case <-time.After(200 * time.Millisecond):
	}
	// Guests cannot be comped.
	g, _ := h.sys.CreateGuest(context.Background(), "192.0.2.9")
	h.fail(admin, "sub.grant", map[string]any{"person": g.ID, "until": "30d"}, "invalid_argument")
}

func jsonInt(n int64) string { b, _ := json.Marshal(n); return string(b) }

// P5 exit, with the fake gateway: checkout, a webhook for an active
// subscription makes the member a subscriber; a cancellation past
// access_until demotes them.
func TestStripeSubscription(t *testing.T) {
	h := newHarnessWith(t, func(c *config.Config) { c.Stripe = config.Stripe{Prices: []string{"price_sub"}} })
	fake := stripe.NewFake(h.cfg.Hosts.Main)
	svc := h.srv.SetBilling(fake, false)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = svc.Run(ctx) }()

	s, v, me := clubSite(t, h, "sol@example.com")
	pg := newPage(t, s, h.cfg.Hosts.Live[0], v)
	sol := h.tokenFor("sol@example.com")

	// billing.checkout makes a Customer and a Checkout; a second call
	// returns the same Session.
	out := h.call(sol, "billing.checkout", map[string]any{}).(map[string]any)
	again := h.call(sol, "billing.checkout", map[string]any{"price": "price_sub"}).(map[string]any)
	if !strings.HasPrefix(out["url"].(string), "https://checkout.example/cs_") || out["url"] != again["url"] {
		t.Fatalf("checkout = %v, again %v", out, again)
	}
	h.fail(sol, "billing.checkout", map[string]any{"price": "price_other"}, "invalid_argument")
	customer, err := h.sys.CustomerFor(ctx, me)
	if err != nil {
		t.Fatal(err)
	}

	// Paid: Stripe now has an active subscription, and sends a webhook.
	future := time.Now().Add(30 * 24 * time.Hour)
	fake.SetSubscription(customer, billing.Subscription{ID: "sub_1", PriceID: "price_sub", Status: "active", Quantity: 1, ItemCount: 1, AccessUntil: &future})
	webhook := func(id, typ string) int {
		body, _ := json.Marshal(map[string]string{"id": id, "type": typ, "customer": customer})
		req, _ := http.NewRequest("POST", h.ts.URL+"/webhooks/stripe", bytes.NewReader(body))
		req.Host = h.cfg.Hosts.Main
		req.Header.Set("Stripe-Signature", "fake")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if code := webhook("evt_1", "customer.subscription.created"); code != 200 {
		t.Fatalf("webhook: %d", code)
	}
	pg.expect("interact", 3*time.Second)
	d := h.call(sol, "sub.show", map[string]any{}).(map[string]any)["decision"].(map[string]any)
	if d["reason"] != "subscriber" || d["priceId"] != "price_sub" {
		t.Fatalf("decision = %v", d)
	}
	// A duplicate delivery is accepted and changes nothing.
	if code := webhook("evt_1", "customer.subscription.created"); code != 200 {
		t.Fatalf("duplicate webhook: %d", code)
	}
	// A bad signature is refused.
	req, _ := http.NewRequest("POST", h.ts.URL+"/webhooks/stripe", strings.NewReader(`{"id":"evt_x","type":"invoice.paid"}`))
	req.Host = h.cfg.Hosts.Main
	req.Header.Set("Stripe-Signature", "forged")
	if resp, _ := http.DefaultClient.Do(req); resp.StatusCode != 400 {
		t.Fatalf("forged webhook: %d", resp.StatusCode)
	}
	// With an open subscription, checkout sends people to the portal.
	h.fail(sol, "billing.checkout", map[string]any{}, "conflict")
	if p := h.call(sol, "billing.portal", map[string]any{}).(map[string]any); !strings.Contains(p["url"].(string), customer) {
		t.Fatalf("portal = %v", p)
	}

	// Canceled, and the paid period is over: demoted.
	past := time.Now().Add(-time.Hour)
	fake.SetSubscription(customer, billing.Subscription{ID: "sub_1", PriceID: "price_sub", Status: "canceled", Quantity: 1, ItemCount: 1, AccessUntil: &past, CanceledAt: &past})
	webhook("evt_2", "customer.subscription.deleted")
	pg.expect("view", 3*time.Second)
	if d := h.call(sol, "sub.show", map[string]any{}).(map[string]any)["decision"].(map[string]any); d["allowed"] != false {
		t.Fatalf("decision after cancel = %v", d)
	}
}

// The subscribe page: signed-in only; with Stripe, a Subscribe button.
func TestSubscribePage(t *testing.T) {
	h := newHarnessWith(t, func(c *config.Config) { c.Stripe = config.Stripe{Prices: []string{"price_sub"}} })
	h.srv.SetBilling(stripe.NewFake(h.cfg.Hosts.Main), false)
	b := h.browser()
	if r := b.do("GET", "/subscribe", h.cfg.Hosts.Main, nil, nil); r.StatusCode != 303 {
		t.Fatalf("signed out: %d", r.StatusCode)
	}
	b.signIn("una@example.com")
	r := b.do("GET", "/subscribe", h.cfg.Hosts.Main, nil, nil)
	var buf bytes.Buffer
	_, _ = buf.ReadFrom(r.Body)
	page := buf.String()
	if r.StatusCode != 200 || !strings.Contains(page, `action="/billing/checkout"`) || !strings.Contains(page, `value="price_sub"`) {
		t.Fatalf("subscribe page: %d %s", r.StatusCode, page)
	}
	// A form post without the CSRF token is refused.
	if r := b.do("POST", "/billing/checkout", h.cfg.Hosts.Main, strings.NewReader("price=price_sub"), map[string]string{"Content-Type": "application/x-www-form-urlencoded"}); r.StatusCode != 403 {
		t.Fatalf("checkout without csrf: %d", r.StatusCode)
	}
}
