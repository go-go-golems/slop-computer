package stripe

import (
	"context"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/billing"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

var (
	// ErrSubscriptionOpen sends the person to billing management instead of
	// a second Checkout.
	ErrSubscriptionOpen = errors.New("an open subscription already exists")
	ErrNoCustomer       = errors.New("no billing account yet")
	ErrCheckoutExpired  = errors.New("the earlier checkout expired; try again")
	ErrForeignSession   = errors.New("checkout session does not belong to this account")
	// ErrCheckoutSuperseded: a concurrent request for another price
	// replaced this Checkout.
	ErrCheckoutSuperseded = errors.New("checkout superseded by another price")
)

type Config struct {
	Livemode   bool
	Deployment string // stable idempotency namespace
}

// Person is who checks out: a user's id, email and name.
type Person struct{ ID, Email, Name string }

type Service struct {
	Gateway Gateway
	Store   *billing.Book
	Config  Config
	wake    chan struct{}
	// OnChange is called after a person's projection changed.
	OnChange func(person string)
}

func NewService(g Gateway, s *billing.Book, cfg Config) *Service {
	return &Service{Gateway: g, Store: s, Config: cfg, wake: make(chan struct{}, 1)}
}

func (s *Service) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// ensureCustomer maps the person to exactly one Customer. A stable
// idempotency key means a retry after a failed database write adopts the
// same Customer.
func (s *Service) ensureCustomer(ctx context.Context, u Person) (string, error) {
	id, err := s.Store.CustomerFor(ctx, u.ID)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, sysdb.ErrNotFound) {
		return "", err
	}
	id, err = s.Gateway.CreateCustomer(ctx, u.ID, s.Config.Deployment, u.Email, u.Name, s.Config.Deployment+"-customer-"+u.ID)
	if err != nil {
		return "", fmt.Errorf("create Stripe customer: %w", err)
	}
	return s.Store.SaveCustomer(ctx, u.ID, id)
}

// Checkout returns a hosted Checkout URL for price that returns to back
// (the subscribe page). An open subscription on any accepted price sends
// the person to the billing portal instead of a second subscription.
// Double clicks and retries for one price resolve to the same attempt and
// Session; a request for another price retires the earlier attempt first.
func (s *Service) Checkout(ctx context.Context, u Person, price string, accepted map[string]bool, back string) (string, error) {
	if customer, err := s.Store.CustomerFor(ctx, u.ID); err == nil {
		subs, err := s.Gateway.CustomerSubscriptions(ctx, customer)
		if err != nil {
			return "", fmt.Errorf("refresh subscriptions: %w", err)
		}
		for _, sub := range subs {
			if accepted[sub.PriceID] && billing.OpenStatus(sub.Status) {
				_ = s.Store.EnqueueRefresh(ctx, customer, "checkout")
				s.Wake()
				return "", ErrSubscriptionOpen
			}
		}
	}
	customer, err := s.ensureCustomer(ctx, u)
	if err != nil {
		return "", err
	}
	attempt, _, err := s.Store.AdmitCheckout(ctx, u.ID, price)
	if err != nil {
		return "", err
	}
	if attempt.Price != price {
		if err = s.supersede(ctx, attempt); err != nil {
			return "", err
		}
		if attempt, _, err = s.Store.AdmitCheckout(ctx, u.ID, price); err != nil {
			return "", err
		}
		if attempt.Price != price {
			return "", ErrCheckoutSuperseded
		}
	}
	if attempt.State == "open" && attempt.SessionURL != nil && attempt.ExpiresAt != nil && time.Now().Before(*attempt.ExpiresAt) {
		return *attempt.SessionURL, nil
	}
	// Once a Session id is known, never recreate it with the old
	// idempotency key: Stripe can evict that key.
	if attempt.SessionID != nil {
		if err = s.supersede(ctx, attempt); err != nil {
			return "", err
		}
		return "", ErrCheckoutExpired
	}
	cs, err := s.Gateway.CreateCheckout(ctx, CheckoutRequest{
		CustomerID: customer, PriceID: price, UserID: u.ID, AttemptID: attempt.ID,
		SuccessURL:     back + "?checkout={CHECKOUT_SESSION_ID}",
		CancelURL:      back,
		IdempotencyKey: s.Config.Deployment + "-checkout-" + attempt.ID,
	})
	if err != nil {
		return "", fmt.Errorf("create Checkout session: %w", err)
	}
	if err = s.Store.OpenCheckout(ctx, attempt.ID, cs.ID, cs.URL, cs.ExpiresAt); errors.Is(err, sysdb.ErrNotFound) {
		// Another price retired this attempt while the Session was being
		// created; its URL must not reach the browser.
		if xerr := s.Gateway.ExpireCheckout(ctx, cs.ID); xerr != nil {
			log.Printf("expire superseded Checkout session %s: %v", cs.ID, xerr)
		}
		return "", ErrCheckoutSuperseded
	}
	if err != nil {
		return "", err
	}
	return cs.URL, nil
}

// supersede retires an admitted attempt for another price. An open Session
// is expired at Stripe; a completed one means a subscription is on its way.
func (s *Service) supersede(ctx context.Context, a billing.CheckoutAttempt) error {
	if a.SessionID != nil {
		cs, err := s.Gateway.RetrieveCheckout(ctx, *a.SessionID)
		if err != nil {
			return fmt.Errorf("retrieve earlier Checkout session: %w", err)
		}
		switch cs.Status {
		case "complete":
			_ = s.Store.FinishCheckout(ctx, a.ID, "completed", "")
			if cs.CustomerID != "" {
				_ = s.Store.EnqueueRefresh(ctx, cs.CustomerID, "checkout")
				s.Wake()
			}
			return ErrSubscriptionOpen
		case "open":
			if err = s.Gateway.ExpireCheckout(ctx, cs.ID); err != nil {
				return fmt.Errorf("expire earlier Checkout session: %w", err)
			}
		}
	}
	return s.Store.FinishCheckout(ctx, a.ID, "expired", "superseded")
}

// Portal creates a Customer Portal session for the person's own Customer.
func (s *Service) Portal(ctx context.Context, u Person, back string) (string, error) {
	customer, err := s.Store.CustomerFor(ctx, u.ID)
	if errors.Is(err, sysdb.ErrNotFound) {
		return "", ErrNoCustomer
	}
	if err != nil {
		return "", err
	}
	return s.Gateway.CreatePortal(ctx, customer, back)
}

// Refresh queues a reconciliation for the person, as when the browser comes
// back from Checkout. A Checkout session reference must be theirs.
func (s *Service) Refresh(ctx context.Context, u Person, sessionID string) error {
	if sessionID != "" {
		a, err := s.Store.CheckoutBySession(ctx, sessionID)
		if err != nil || a.Person != u.ID {
			return ErrForeignSession
		}
	}
	customer, err := s.Store.CustomerFor(ctx, u.ID)
	if errors.Is(err, sysdb.ErrNotFound) {
		return ErrNoCustomer
	}
	if err != nil {
		return err
	}
	if err = s.Store.EnqueueRefresh(ctx, customer, "return"); err != nil {
		return err
	}
	s.Wake()
	return nil
}

// Ingest verifies a raw webhook body and records it.
func (s *Service) Ingest(ctx context.Context, payload []byte, signature string) (Event, error) {
	e, err := s.Gateway.ConstructEvent(payload, signature)
	if err != nil {
		return e, err
	}
	if e.Livemode != s.Config.Livemode {
		return e, errors.New("event mode does not match deployment")
	}
	rec := billing.StripeEvent{EventID: e.ID, Type: e.Type, CustomerID: e.CustomerID, SubscriptionID: e.SubscriptionID, SessionID: e.SessionID,
		Livemode: e.Livemode, StripeCreated: &e.Created}
	if !e.Supported {
		rec.State = "ignored"
	}
	if _, err = s.Store.InsertEvent(ctx, rec); err != nil {
		return e, err
	}
	if e.Supported {
		s.Wake()
	}
	return e, nil
}

// Run drains the inbox and reconciles periodically until ctx ends.
func (s *Service) Run(ctx context.Context) error {
	poll := time.NewTicker(5 * time.Second)
	defer poll.Stop()
	reconcile := time.NewTicker(10 * time.Minute)
	defer reconcile.Stop()
	for {
		s.Drain(ctx)
		select {
		case <-ctx.Done():
			return nil
		case <-s.wake:
		case <-poll.C:
		case <-reconcile.C:
			s.reconcile(ctx)
		}
	}
}

// Drain processes due events until none is left.
func (s *Service) Drain(ctx context.Context) {
	for {
		worked, err := s.processOne(ctx)
		if err != nil && ctx.Err() == nil {
			log.Printf("billing worker: %v", err)
		}
		if !worked || ctx.Err() != nil {
			return
		}
	}
}

func (s *Service) processOne(ctx context.Context) (bool, error) {
	e, err := s.Store.ClaimEvent(ctx, 2*time.Minute)
	if errors.Is(err, sysdb.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	backoff := time.Duration(1<<min(e.Attempts, 10)) * 5 * time.Second
	terminal := e.Attempts >= 12
	call, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	customer := e.CustomerID
	if customer == "" && e.SubscriptionID != "" {
		if customer, err = s.Gateway.SubscriptionCustomer(call, e.SubscriptionID); err != nil {
			return true, s.Store.FailEvent(ctx, e, "subscription_lookup_failed", backoff, terminal)
		}
	}
	if customer == "" {
		return true, s.Store.CompleteEvent(ctx, e, "", nil, "ignored")
	}
	person, err := s.Store.PersonForCustomer(ctx, customer)
	if errors.Is(err, sysdb.ErrNotFound) {
		// A Stripe account can be shared with other applications; their
		// Customers are not ours to retry.
		dep, derr := s.Gateway.CustomerDeployment(call, customer)
		if derr != nil {
			return true, s.Store.FailEvent(ctx, e, "stripe_unavailable", backoff, terminal)
		}
		if dep != s.Config.Deployment {
			return true, s.Store.CompleteEvent(ctx, e, "", nil, "ignored")
		}
		// Never create people from event data; retry in case the mapping
		// write is still in flight.
		return true, s.Store.FailEvent(ctx, e, "unknown_customer", backoff, terminal)
	}
	if err != nil {
		return true, err
	}
	subs, err := s.Gateway.CustomerSubscriptions(call, customer)
	if err != nil {
		return true, s.Store.FailEvent(ctx, e, "stripe_unavailable", backoff, terminal)
	}
	if e.SessionID != "" {
		if a, aerr := s.Store.CheckoutBySession(ctx, e.SessionID); aerr == nil {
			state := "completed"
			if e.Type == "checkout.session.expired" {
				state = "expired"
			}
			_ = s.Store.FinishCheckout(ctx, a.ID, state, "")
		}
	}
	if err = s.Store.CompleteEvent(ctx, e, person, subs, "processed"); err != nil {
		return true, err
	}
	if s.OnChange != nil {
		s.OnChange(person)
	}
	return true, nil
}

// reconcile re-queues refreshes through the inbox and resolves Checkout
// attempts left pending by crashes or lost returns.
func (s *Service) reconcile(ctx context.Context) {
	if customers, err := s.Store.CustomersToReconcile(ctx); err == nil {
		for _, c := range customers {
			_ = s.Store.EnqueueRefresh(ctx, c, "scheduled")
		}
	}
	attempts, err := s.Store.DueCheckouts(ctx)
	if err != nil {
		return
	}
	for _, a := range attempts {
		if a.SessionID == nil {
			if time.Since(a.CreatedAt) > time.Hour {
				_ = s.Store.FinishCheckout(ctx, a.ID, "failed", "creation_uncertain")
			}
			continue
		}
		cs, err := s.Gateway.RetrieveCheckout(ctx, *a.SessionID)
		if err != nil {
			continue
		}
		switch cs.Status {
		case "complete":
			_ = s.Store.FinishCheckout(ctx, a.ID, "completed", "")
			if cs.CustomerID != "" {
				_ = s.Store.EnqueueRefresh(ctx, cs.CustomerID, "checkout")
			}
		case "expired":
			_ = s.Store.FinishCheckout(ctx, a.ID, "expired", "")
		}
	}
	s.Wake()
}

// ReconcilePerson is the operator entry point; it uses the same queue.
func (s *Service) ReconcilePerson(ctx context.Context, person string) error {
	customer, err := s.Store.CustomerFor(ctx, person)
	if err != nil {
		return err
	}
	if err = s.Store.EnqueueRefresh(ctx, customer, "operator"); err != nil {
		return err
	}
	s.Wake()
	return nil
}
