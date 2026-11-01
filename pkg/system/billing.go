package system

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/go-go-golems/slop/pkg/billing"
	"github.com/go-go-golems/slop/pkg/ids"
)

// Billing storage: comps and the Stripe projection, ported from
// francois's pkg/catalog/store/billing.go (Postgres) to system.db. Times
// are milliseconds.

// ErrConflict: a lease or a concurrent change was lost.
var ErrConflict = errors.New("conflict")

func msTime(v sql.NullInt64) *time.Time {
	if !v.Valid {
		return nil
	}
	t := time.UnixMilli(v.Int64).UTC()
	return &t
}

func timeMs(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UnixMilli()
}

// --- comps -----------------------------------------------------------------

// CompRow is a complimentary access grant.
type CompRow struct {
	ID        string `json:"id"`
	Person    string `json:"person"`
	Until     int64  `json:"until"`
	RevokedAt int64  `json:"revokedAt,omitempty"`
	Note      string `json:"note,omitempty"`
	CreatedBy string `json:"createdBy"`
	CreatedAt int64  `json:"createdAt"`
}

// GrantComp gives person standing access until until (ms).
func (d *DB) GrantComp(ctx context.Context, actor, via, person string, until int64, note string) (CompRow, error) {
	c := CompRow{ID: ids.New("cmp_", 10), Person: person, Until: until, Note: note, CreatedBy: actor, CreatedAt: d.NowMs()}
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `INSERT INTO comps (id, person, until, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
			c.ID, person, until, nullStr(note), actor, c.CreatedAt); err != nil {
			return err
		}
		_, err := Log(ctx, tx, c.CreatedAt, actor, via, "comp for "+person+" until "+time.UnixMilli(until).UTC().Format("2006-01-02"),
			Change{Kind: "comp", Key: person, Op: "grant", After: c.ID})
		return err
	})
	return c, err
}

// RevokeComp ends a comp now. It returns the person.
func (d *DB) RevokeComp(ctx context.Context, actor, via, id string) (string, error) {
	var person string
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `SELECT person FROM comps WHERE id = ?`, id).Scan(&person); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		now := d.NowMs()
		if _, err := tx.ExecContext(ctx, `UPDATE comps SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`, now, id); err != nil {
			return err
		}
		_, err := Log(ctx, tx, now, actor, via, "revoked comp "+id+" of "+person, Change{Kind: "comp", Key: person, Op: "revoke", Before: id})
		return err
	})
	return person, err
}

// CompRows lists comps, of one person or of everyone (person "").
func (d *DB) CompRows(ctx context.Context, person string) ([]CompRow, error) {
	rows, err := d.QueryContext(ctx, `SELECT id, person, until, coalesce(revoked_at, 0), coalesce(note, ''), created_by, created_at
		FROM comps WHERE ? = '' OR person = ? ORDER BY created_at DESC`, person, person)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CompRow{}
	for rows.Next() {
		var c CompRow
		if err := rows.Scan(&c.ID, &c.Person, &c.Until, &c.RevokedAt, &c.Note, &c.CreatedBy, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// Comps returns a person's comps for the policy.
func (d *DB) Comps(ctx context.Context, person string) ([]billing.Comp, error) {
	rows, err := d.CompRows(ctx, person)
	if err != nil {
		return nil, err
	}
	out := make([]billing.Comp, 0, len(rows))
	for _, c := range rows {
		out = append(out, billing.Comp{Until: time.UnixMilli(c.Until).UTC(), Revoked: c.RevokedAt != 0})
	}
	return out, nil
}

// --- customers and subscriptions ---------------------------------------------

func (d *DB) CustomerFor(ctx context.Context, person string) (string, error) {
	var id string
	err := d.QueryRowContext(ctx, `SELECT customer_id FROM stripe_customers WHERE person = ?`, person).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

// SaveCustomer keeps the first mapping and returns the stored Customer, so
// a retried creation adopts the same one.
func (d *DB) SaveCustomer(ctx context.Context, person, customer string) (string, error) {
	if _, err := d.ExecContext(ctx, `INSERT INTO stripe_customers (person, customer_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
		person, customer, d.NowMs()); err != nil {
		return "", err
	}
	return d.CustomerFor(ctx, person)
}

func (d *DB) PersonForCustomer(ctx context.Context, customer string) (string, error) {
	var id string
	err := d.QueryRowContext(ctx, `SELECT person FROM stripe_customers WHERE customer_id = ?`, customer).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	return id, err
}

const subColumns = `subscription_id, customer_id, price_id, status, quantity, item_count, access_until, trial_until, cancel_at_period_end, canceled_at, refreshed_at`

func scanSub(r interface{ Scan(...any) error }) (billing.Subscription, string, error) {
	var s billing.Subscription
	var person string
	var access, trial, canceled sql.NullInt64
	var refreshed int64
	err := r.Scan(&s.ID, &s.CustomerID, &s.PriceID, &s.Status, &s.Quantity, &s.ItemCount, &access, &trial, &s.CancelAtPeriodEnd, &canceled, &refreshed, &person)
	s.AccessUntil, s.TrialUntil, s.CanceledAt = msTime(access), msTime(trial), msTime(canceled)
	s.RefreshedAt = time.UnixMilli(refreshed).UTC()
	return s, person, err
}

// Subscriptions returns a person's projected subscriptions.
func (d *DB) Subscriptions(ctx context.Context, person string) ([]billing.Subscription, error) {
	rows, err := d.QueryContext(ctx, `SELECT `+subColumns+`, person FROM stripe_subscriptions WHERE person = ? ORDER BY refreshed_at DESC`, person)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []billing.Subscription{}
	for rows.Next() {
		s, _, err := scanSub(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// SubscriptionPerson returns a subscription's customer and person.
func (d *DB) SubscriptionPerson(ctx context.Context, id string) (billing.Subscription, string, error) {
	s, p, err := scanSub(d.QueryRowContext(ctx, `SELECT `+subColumns+`, person FROM stripe_subscriptions WHERE subscription_id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return s, p, ErrNotFound
	}
	return s, p, err
}

func upsertSubscriptions(ctx context.Context, tx *sql.Tx, now int64, person string, subs []billing.Subscription, live bool) error {
	for _, s := range subs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO stripe_subscriptions (subscription_id, person, customer_id, price_id, status, quantity, item_count,
			access_until, trial_until, cancel_at_period_end, canceled_at, livemode, refreshed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT (subscription_id) DO UPDATE SET price_id = excluded.price_id, status = excluded.status, quantity = excluded.quantity,
			item_count = excluded.item_count, access_until = excluded.access_until, trial_until = excluded.trial_until,
			cancel_at_period_end = excluded.cancel_at_period_end, canceled_at = excluded.canceled_at, refreshed_at = excluded.refreshed_at
			WHERE stripe_subscriptions.person = excluded.person`,
			s.ID, person, s.CustomerID, s.PriceID, s.Status, s.Quantity, s.ItemCount, timeMs(s.AccessUntil), timeMs(s.TrialUntil),
			s.CancelAtPeriodEnd, timeMs(s.CanceledAt), live, now); err != nil {
			return err
		}
	}
	return nil
}

// --- checkout attempts -----------------------------------------------------------

// CheckoutAttempt is one admitted Checkout for a person.
type CheckoutAttempt struct {
	ID         string  `json:"id"`
	Person     string  `json:"person"`
	Price      string  `json:"price"`
	State      string  `json:"state"`
	SessionID  *string `json:"sessionId,omitempty"`
	SessionURL *string `json:"-"`
	ExpiresAt  *time.Time
	ErrorCode  *string `json:"errorCode,omitempty"`
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

const attemptColumns = `id, person, price, state, session_id, session_url, expires_at, error_code, created_at, updated_at`

func scanAttempt(r interface{ Scan(...any) error }) (CheckoutAttempt, error) {
	var a CheckoutAttempt
	var sid, surl, code sql.NullString
	var exp sql.NullInt64
	var created, updated int64
	err := r.Scan(&a.ID, &a.Person, &a.Price, &a.State, &sid, &surl, &exp, &code, &created, &updated)
	if errors.Is(err, sql.ErrNoRows) {
		return a, ErrNotFound
	}
	if sid.Valid {
		a.SessionID = &sid.String
	}
	if surl.Valid {
		a.SessionURL = &surl.String
	}
	if code.Valid {
		a.ErrorCode = &code.String
	}
	a.ExpiresAt = msTime(exp)
	a.CreatedAt, a.UpdatedAt = time.UnixMilli(created).UTC(), time.UnixMilli(updated).UTC()
	return a, err
}

// AdmitCheckout returns the person's admitted attempt, creating a pending
// one for price when none is open. An existing attempt may be for another
// price.
func (d *DB) AdmitCheckout(ctx context.Context, person, price string) (CheckoutAttempt, bool, error) {
	var a CheckoutAttempt
	created := false
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		if _, err := tx.ExecContext(ctx, `UPDATE checkout_attempts SET state = 'expired', updated_at = ? WHERE person = ? AND state = 'open' AND expires_at < ?`, now, person, now); err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `INSERT INTO checkout_attempts (id, person, price, state, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?) ON CONFLICT DO NOTHING`,
			ids.New("chk_", 10), person, price, now, now)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		created = n == 1
		a, err = scanAttempt(tx.QueryRowContext(ctx, `SELECT `+attemptColumns+` FROM checkout_attempts WHERE person = ? AND state IN ('pending', 'open')`, person))
		return err
	})
	return a, created, err
}

// OpenCheckout records the Session of an admitted attempt. ErrNotFound: the
// attempt was retired meanwhile.
func (d *DB) OpenCheckout(ctx context.Context, id, session, url string, expires time.Time) error {
	res, err := d.ExecContext(ctx, `UPDATE checkout_attempts SET state = 'open', session_id = ?, session_url = ?, expires_at = ?, updated_at = ? WHERE id = ? AND state IN ('pending', 'open')`,
		session, url, expires.UnixMilli(), d.NowMs(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (d *DB) FinishCheckout(ctx context.Context, id, state, code string) error {
	_, err := d.ExecContext(ctx, `UPDATE checkout_attempts SET state = ?, error_code = nullif(?, ''), updated_at = ? WHERE id = ? AND state IN ('pending', 'open')`,
		state, code, d.NowMs(), id)
	return err
}

func (d *DB) CheckoutBySession(ctx context.Context, session string) (CheckoutAttempt, error) {
	return scanAttempt(d.QueryRowContext(ctx, `SELECT `+attemptColumns+` FROM checkout_attempts WHERE session_id = ?`, session))
}

// DueCheckouts lists pending or open attempts untouched for two minutes.
func (d *DB) DueCheckouts(ctx context.Context) ([]CheckoutAttempt, error) {
	rows, err := d.QueryContext(ctx, `SELECT `+attemptColumns+` FROM checkout_attempts WHERE state IN ('pending', 'open') AND updated_at < ? ORDER BY updated_at, id LIMIT 50`,
		d.NowMs()-2*60*1000)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CheckoutAttempt{}
	for rows.Next() {
		a, err := scanAttempt(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// --- the Stripe event inbox ----------------------------------------------------------

// StripeEvent is a webhook (or a synthetic refresh) waiting to be applied.
type StripeEvent struct {
	EventID, Type, CustomerID, SubscriptionID, SessionID string
	Livemode                                             bool
	State                                                string
	Attempts                                             int
	StripeCreated                                        *time.Time
	LeaseToken                                           string
}

// InsertEvent records an event once; duplicates are accepted.
func (d *DB) InsertEvent(ctx context.Context, e StripeEvent) (bool, error) {
	state := "pending"
	if e.State == "ignored" {
		state = "ignored"
	}
	now := d.NowMs()
	var processed any
	if state == "ignored" {
		processed = now
	}
	res, err := d.ExecContext(ctx, `INSERT INTO stripe_events (event_id, type, customer_id, subscription_id, session_id, livemode, state, next_attempt_at, stripe_created_at, received_at, processed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
		e.EventID, e.Type, e.CustomerID, e.SubscriptionID, e.SessionID, e.Livemode, state, now, timeMs(e.StripeCreated), now, processed)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n == 1, nil
}

// EnqueueRefresh adds a synthetic refresh request for a Customer, so
// reconciliation and operators share the webhook path.
func (d *DB) EnqueueRefresh(ctx context.Context, customer, reason string) error {
	now := d.NowMs()
	_, err := d.ExecContext(ctx, `INSERT INTO stripe_events (event_id, type, customer_id, next_attempt_at, received_at) VALUES (?, ?, ?, ?, ?)`,
		ids.New("refresh_", 10), "slop.refresh."+reason, customer, now, now)
	return err
}

// ClaimEvent leases one due pending event.
func (d *DB) ClaimEvent(ctx context.Context, lease time.Duration) (StripeEvent, error) {
	var e StripeEvent
	token := ids.New("", 16)
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		err := tx.QueryRowContext(ctx, `SELECT event_id, type, customer_id, subscription_id, session_id, livemode, state, attempts FROM stripe_events
			WHERE state = 'pending' AND next_attempt_at <= ? AND (lease_until IS NULL OR lease_until < ?) ORDER BY next_attempt_at LIMIT 1`, now, now).
			Scan(&e.EventID, &e.Type, &e.CustomerID, &e.SubscriptionID, &e.SessionID, &e.Livemode, &e.State, &e.Attempts)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		e.Attempts++
		e.LeaseToken = token
		_, err = tx.ExecContext(ctx, `UPDATE stripe_events SET lease_token = ?, lease_until = ?, attempts = attempts + 1 WHERE event_id = ?`, token, now+lease.Milliseconds(), e.EventID)
		return err
	})
	return e, err
}

// CompleteEvent writes a person's current subscriptions and marks the event
// done, in one transaction, if the lease is still owned.
func (d *DB) CompleteEvent(ctx context.Context, e StripeEvent, person string, subs []billing.Subscription, state string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM stripe_events WHERE event_id = ? AND lease_token = ?`, e.EventID, e.LeaseToken).Scan(&n); err != nil {
			return err
		}
		if n == 0 {
			return ErrConflict
		}
		now := d.NowMs()
		if person != "" {
			if err := upsertSubscriptions(ctx, tx, now, person, subs, e.Livemode); err != nil {
				return err
			}
			if _, err := Log(ctx, tx, now, "system", "stripe", "billing refreshed for "+person, Change{Kind: "billing", Key: person, Op: "refresh"}); err != nil {
				return err
			}
		}
		_, err := tx.ExecContext(ctx, `UPDATE stripe_events SET state = ?, processed_at = ?, lease_token = NULL, lease_until = NULL, error_code = NULL WHERE event_id = ?`,
			state, now, e.EventID)
		return err
	})
}

// FailEvent schedules a retry with backoff, or gives up (terminal).
func (d *DB) FailEvent(ctx context.Context, e StripeEvent, code string, backoff time.Duration, terminal bool) error {
	state := "pending"
	if terminal {
		state = "error"
	}
	_, err := d.ExecContext(ctx, `UPDATE stripe_events SET state = ?, error_code = ?, next_attempt_at = ?, lease_token = NULL, lease_until = NULL WHERE event_id = ? AND lease_token = ?`,
		state, code, d.NowMs()+backoff.Milliseconds(), e.EventID, e.LeaseToken)
	return err
}

// CustomersToReconcile are Customers with live subscriptions not refreshed
// for six hours.
func (d *DB) CustomersToReconcile(ctx context.Context) ([]string, error) {
	rows, err := d.QueryContext(ctx, `SELECT customer_id FROM stripe_subscriptions WHERE status NOT IN ('canceled', 'incomplete_expired') AND refreshed_at < ?
		GROUP BY customer_id ORDER BY min(refreshed_at) LIMIT 50`, d.NowMs()-6*3600*1000)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// NextAccessChange is the earliest future moment at which someone's
// standing access may lapse: a comp's until or a subscription's
// access_until. Zero when none is scheduled.
func (d *DB) NextAccessChange(ctx context.Context, now int64) int64 {
	var next sql.NullInt64
	_ = d.QueryRowContext(ctx, `SELECT min(t) FROM (
		SELECT until AS t FROM comps WHERE revoked_at IS NULL AND until > ?
		UNION ALL SELECT access_until FROM stripe_subscriptions WHERE access_until > ?
		UNION ALL SELECT trial_until FROM stripe_subscriptions WHERE trial_until > ?)`, now, now, now).Scan(&next)
	return next.Int64
}
