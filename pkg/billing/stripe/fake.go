package stripe

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/go-go-golems/slop/pkg/billing"
)

// Fake is an in-memory Gateway for tests and `slop serve --test`. Webhook
// bodies are JSON {id, type, customer, subscription, session}; the
// signature must be "fake".
type Fake struct {
	mu         sync.Mutex
	n          int
	Customers  map[string]string // customer -> deployment
	Sessions   map[string]CheckoutSession
	Subs       map[string][]billing.Subscription // customer -> subscriptions
	Deployment string
}

var _ Gateway = (*Fake)(nil)

func NewFake(deployment string) *Fake {
	return &Fake{Customers: map[string]string{}, Sessions: map[string]CheckoutSession{}, Subs: map[string][]billing.Subscription{}, Deployment: deployment}
}

func (f *Fake) next(prefix string) string {
	f.n++
	return prefix + strconv.Itoa(f.n)
}

func (f *Fake) CreateCustomer(ctx context.Context, userID, deployment, email, name, key string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := f.next("cus_")
	f.Customers[id] = deployment
	return id, nil
}

func (f *Fake) CustomerDeployment(ctx context.Context, id string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.Customers[id], nil
}

func (f *Fake) CreateCheckout(ctx context.Context, r CheckoutRequest) (CheckoutSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := f.next("cs_")
	s := CheckoutSession{ID: id, URL: "https://checkout.example/" + id, Status: "open", CustomerID: r.CustomerID, ExpiresAt: time.Now().Add(time.Hour)}
	f.Sessions[id] = s
	return s, nil
}

func (f *Fake) RetrieveCheckout(ctx context.Context, id string) (CheckoutSession, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.Sessions[id]
	if !ok {
		return s, errors.New("no such session")
	}
	return s, nil
}

func (f *Fake) ExpireCheckout(ctx context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	s := f.Sessions[id]
	s.Status = "expired"
	f.Sessions[id] = s
	return nil
}

func (f *Fake) CreatePortal(ctx context.Context, customer, back string) (string, error) {
	return "https://billing.example/" + customer + "?return=" + back, nil
}

func (f *Fake) SubscriptionCustomer(ctx context.Context, id string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for c, subs := range f.Subs {
		for _, s := range subs {
			if s.ID == id {
				return c, nil
			}
		}
	}
	return "", errors.New("no such subscription")
}

func (f *Fake) SetCancelAtPeriodEnd(ctx context.Context, id string, cancel bool) error { return nil }

func (f *Fake) CustomerSubscriptions(ctx context.Context, customer string) ([]billing.Subscription, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]billing.Subscription(nil), f.Subs[customer]...), nil
}

// SetSubscription makes customer's only subscription s (what Stripe would
// now return for them).
func (f *Fake) SetSubscription(customer string, s billing.Subscription) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s.CustomerID = customer
	f.Subs[customer] = []billing.Subscription{s}
}

func (f *Fake) ConstructEvent(payload []byte, signature string) (Event, error) {
	if signature != "fake" {
		return Event{}, errors.New("invalid Stripe signature")
	}
	var in struct{ ID, Type, Customer, Subscription, Session string }
	if err := json.Unmarshal(payload, &in); err != nil {
		return Event{}, err
	}
	return Event{ID: in.ID, Type: in.Type, Created: time.Now(), CustomerID: in.Customer, SubscriptionID: in.Subscription,
		SessionID: in.Session, Supported: supported[in.Type]}, nil
}
