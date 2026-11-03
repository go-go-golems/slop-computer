package llm

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"time"
)

// --- the budget ledger (SLOP3-007 phase 5) -----------------------------------
//
// A model budget is a limit (authority: from llm_access rows, see LLMFor)
// and a balance (state: llm_usage). The balance changes only through holds:
// Reserve before each model round, Settle with what the round used. For
// every account and month, used + reserved stays within the limit, under
// any interleaving of calls, because Reserve checks and reserves in one
// transaction and each round's output is capped at what its hold covers.
//
// Ledger writes go through ledgerTx, which neither moves the epoch nor
// calls the Listen functions: balances are never part of a cached decision, and a write
// per model round must not make every open view decide again or wake the
// system:* reactors.

// ErrQuota is a refused reservation: the budget left cannot cover the round.
var ErrQuota = errors.New("token budget used up for this month")

// HoldTTL is how long a hold may stay open before ExpireHolds charges it
// in full (the provider may have billed a round whose outcome is unknown).
const HoldTTL = 10 * time.Minute

// Hold is budget set aside for one model round.
type Hold struct {
	ID      string
	Account string
	Period  string
	Amount  int64 // tokens held
	Output  int64 // the round's output cap (0: no cap)
}

func (d *Ledger) ledgerTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Reserve holds budget for one round: the input estimate plus as much
// output as the limit allows, up to maxOut (0: as much as is left; with no
// limit, no cap). It fails with ErrQuota when nothing is left after the
// input. key makes it idempotent: a retry returns the hold it made.
func (d *Ledger) Reserve(ctx context.Context, account string, limit *int64, input, maxOut int64, key string) (Hold, error) {
	h := Hold{ID: key, Account: account}
	err := d.ledgerTx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `SELECT period, amount, output FROM llm_holds WHERE id = ?`, key).Scan(&h.Period, &h.Amount, &h.Output)
		if err == nil {
			return nil // a retry: the hold it already made
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		now := d.Now()
		h.Period = Period(now)
		if _, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO llm_usage (person, period, used_tokens, updated_at) VALUES (?, ?, 0, ?)`,
			account, h.Period, now.UnixMilli()); err != nil {
			return err
		}
		var used, reserved int64
		if err := tx.QueryRowContext(ctx, `SELECT used_tokens, reserved_tokens FROM llm_usage WHERE person = ? AND period = ?`,
			account, h.Period).Scan(&used, &reserved); err != nil {
			return err
		}
		h.Output = maxOut
		if limit != nil {
			avail := *limit - used - reserved - input
			if avail <= 0 {
				return ErrQuota
			}
			if h.Output <= 0 || h.Output > avail {
				h.Output = avail
			}
		}
		h.Amount = input + max(h.Output, 0)
		if _, err := tx.ExecContext(ctx, `INSERT INTO llm_holds (id, account, period, amount, output, state, created_at, expires_at)
			VALUES (?, ?, ?, ?, ?, 'held', ?, ?)`, key, account, h.Period, h.Amount, h.Output, now.UnixMilli(), now.Add(HoldTTL).UnixMilli()); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE llm_usage SET reserved_tokens = reserved_tokens + ?, updated_at = ? WHERE person = ? AND period = ?`,
			h.Amount, now.UnixMilli(), account, h.Period)
		return err
	})
	return h, err
}

// Settle closes a hold with what the round used (used < 0: the whole
// hold, when the outcome is unknown), in the month the hold was taken.
// Settling a closed hold does nothing.
func (d *Ledger) Settle(ctx context.Context, id string, used int64) error {
	return d.closeHold(ctx, id, used, "settled")
}

// Release closes a hold without charging: the round never reached the
// provider.
func (d *Ledger) Release(ctx context.Context, id string) error {
	return d.closeHold(ctx, id, 0, "released")
}

func (d *Ledger) closeHold(ctx context.Context, id string, used int64, state string) error {
	return d.ledgerTx(ctx, func(tx *sql.Tx) error {
		var account, period, cur string
		var amount int64
		err := tx.QueryRowContext(ctx, `SELECT account, period, amount, state FROM llm_holds WHERE id = ?`, id).Scan(&account, &period, &amount, &cur)
		if errors.Is(err, sql.ErrNoRows) || cur != "held" {
			return nil
		}
		if err != nil {
			return err
		}
		if used < 0 {
			used = amount
		}
		if _, err := tx.ExecContext(ctx, `UPDATE llm_holds SET state = ?, used = ? WHERE id = ?`, state, used, id); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `UPDATE llm_usage SET used_tokens = used_tokens + ?, reserved_tokens = max(0, reserved_tokens - ?), updated_at = ?
			WHERE person = ? AND period = ?`, used, amount, d.NowMs(), account, period)
		return err
	})
}

// ExpireHolds charges in full every hold still open past its expiry: a
// crash or a lost usage report must not leak budget. It returns how many.
func (d *Ledger) ExpireHolds(ctx context.Context) (int, error) {
	rows, err := d.QueryContext(ctx, `SELECT id FROM llm_holds WHERE state = 'held' AND expires_at < ?`, d.NowMs())
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := d.Settle(ctx, id, -1); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}

// LLMReserved is what an account's open holds set aside in a period.
func (d *Ledger) LLMReserved(ctx context.Context, account, period string) int64 {
	var n int64
	_ = d.QueryRowContext(ctx, `SELECT reserved_tokens FROM llm_usage WHERE person = ? AND period = ?`, account, period).Scan(&n)
	return n
}

// BudgetMeter is one model call's view of the ledger: the backend asks it before
// each round (Meter), the caller reports each round's usage event and
// closes it when the call ends.
type BudgetMeter struct {
	d       *Ledger
	account string
	limit   *int64
	call    string

	mu  sync.Mutex
	cur string // the open hold, between Before and the round's usage
}

var _ Meter = (*BudgetMeter)(nil)

// NewMeter meters a call for account, against limit (nil: none).
func (d *Ledger) NewMeter(account string, limit *int64, call string) *BudgetMeter {
	return &BudgetMeter{d: d, account: account, limit: limit, call: call}
}

// Before reserves for a round and returns its output cap (0: no cap). A
// round that never reported usage is charged in full first.
func (m *BudgetMeter) Before(ctx context.Context, round int, est Estimate) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cur != "" {
		_ = m.d.Settle(context.Background(), m.cur, -1)
		m.cur = ""
	}
	h, err := m.d.Reserve(context.Background(), m.account, m.limit, est.InputTokens, est.MaxOutputTokens, fmt.Sprintf("%s/%d", m.call, round))
	if errors.Is(err, ErrQuota) {
		return 0, &Failure{Code: "quota_exceeded", Message: ErrQuota.Error()}
	}
	if err != nil {
		return 0, err
	}
	m.cur = h.ID
	return h.Output, nil
}

// Usage settles the open round with its usage event.
func (m *BudgetMeter) Usage(u Usage) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cur == "" {
		return
	}
	_ = m.d.Settle(context.Background(), m.cur, u.Input+u.Output)
	m.cur = ""
}

// Close ends the call: a round still open (no usage arrived) is charged in
// full, since the provider may have billed it.
func (m *BudgetMeter) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cur != "" {
		_ = m.d.Settle(context.Background(), m.cur, -1)
		m.cur = ""
	}
}
