package llm

import (
	"context"
	"database/sql"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// LLMRow is one llm_access row.
type LLMRow struct {
	Subject   string `json:"subject"`
	Allowed   bool   `json:"allowed"`
	Budget    *int64 `json:"budget"` // tokens per calendar month; nil = no limit
	ChangedBy string `json:"changedBy,omitempty"`
	ChangedAt int64  `json:"changedAt"`
}

// LLM is what a person may spend now.
type LLM struct {
	Allowed   bool   `json:"allowed"`
	Budget    *int64 `json:"budget,omitempty"`
	Used      int64  `json:"used"`
	Remaining *int64 `json:"remaining"`        // nil = unlimited
	Source    string `json:"source,omitempty"` // the row that decided: usr_… or @audience
}

// Period is the calendar month (UTC) usage counts in.
func Period(t time.Time) string { return t.UTC().Format("2006-01") }

func (d *Ledger) llmRow(ctx context.Context, subject string) (LLMRow, bool) {
	var r LLMRow
	var budget sql.NullInt64
	var by sql.NullString
	err := d.QueryRowContext(ctx, `SELECT subject, allowed, budget_tokens, changed_by, changed_at FROM llm_access WHERE subject = ?`, subject).
		Scan(&r.Subject, &r.Allowed, &budget, &by, &r.ChangedAt)
	if err != nil {
		return r, false
	}
	if budget.Valid {
		r.Budget = &budget.Int64
	}
	r.ChangedBy = by.String
	return r, true
}

// LLMFor decides a person's LLM access: their own row wins (on or off);
// else the most generous row among their groups' (one without a budget
// beats any budget; a row that is off adds nothing); then this month's
// usage.
func (d *Ledger) LLMFor(ctx context.Context, person, audience string) LLM {
	row, ok := d.llmRow(ctx, person)
	if !ok {
		row, ok = d.groupLLMRow(ctx, audience)
	}
	if !ok || !row.Allowed || person == "" {
		return LLM{}
	}
	period := Period(time.Now())
	out := LLM{Allowed: true, Budget: row.Budget, Used: d.LLMUsed(ctx, person, period), Source: row.Subject}
	if row.Budget != nil {
		// What is left: the limit less what was spent and what open holds
		// set aside (SLOP3-007 ledger).
		rem := max(0, *row.Budget-out.Used-d.LLMReserved(ctx, person, period))
		out.Remaining = &rem
	}
	return out
}

// groupLLMRow is the most generous row that is on among an audience's
// groups.
func (d *Ledger) groupLLMRow(ctx context.Context, audience string) (LLMRow, bool) {
	var best LLMRow
	found := false
	for _, g := range sysdb.GroupsOf(audience) {
		r, ok := d.llmRow(ctx, "@"+g)
		if !ok || !r.Allowed {
			continue
		}
		switch {
		case !found, best.Budget != nil && (r.Budget == nil || *r.Budget > *best.Budget):
			best, found = r, true
		}
	}
	return best, found
}

// LLMUsed is a person's usage in a period.
func (d *Ledger) LLMUsed(ctx context.Context, person, period string) int64 {
	var n int64
	_ = d.QueryRowContext(ctx, `SELECT used_tokens FROM llm_usage WHERE person = ? AND period = ?`, person, period).Scan(&n)
	return n
}

// ResetLLMUsage sets a person's current month to zero.
func (d *Ledger) ResetLLMUsage(ctx context.Context, actor, via, person string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := time.Now()
		if _, err := tx.ExecContext(ctx, `UPDATE llm_usage SET used_tokens = 0, updated_at = ? WHERE person = ? AND period = ?`, now.UnixMilli(), person, Period(now)); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, now.UnixMilli(), actor, via, "reset LLM usage of "+person, sysdb.Change{Kind: "llm", Key: person, Op: "reset"})
		return err
	})
}

// SetLLM writes a subject's access: a person (usr_…, vis_…) or an
// audience (@guest, @member, @subscriber, @admin).
func (d *Ledger) SetLLM(ctx context.Context, actor, via, subject string, allowed bool, budget *int64) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		var b any
		if budget != nil {
			b = *budget
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO llm_access (subject, allowed, budget_tokens, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (subject) DO UPDATE SET allowed = excluded.allowed, budget_tokens = excluded.budget_tokens, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
			subject, allowed, b, actor, now); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, now, actor, via, "llm "+subject+" "+map[bool]string{true: "on", false: "off"}[allowed],
			sysdb.Change{Kind: "llm", Key: subject, Op: "set"})
		return err
	})
}

// RemoveLLM deletes a subject's row (a person falls back to their audience).
func (d *Ledger) RemoveLLM(ctx context.Context, actor, via, subject string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM llm_access WHERE subject = ?`, subject); err != nil {
			return err
		}
		_, err := sysdb.Log(ctx, tx, d.NowMs(), actor, via, "llm "+subject+" removed", sysdb.Change{Kind: "llm", Key: subject, Op: "remove"})
		return err
	})
}

// LLMRows lists llm_access with this month's usage of the people in it.
func (d *Ledger) LLMRows(ctx context.Context) ([]LLMRow, error) {
	rows, err := d.QueryContext(ctx, `SELECT subject, allowed, budget_tokens, coalesce(changed_by, ''), changed_at FROM llm_access ORDER BY subject`)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	out := []LLMRow{}
	for rows.Next() {
		var r LLMRow
		var budget sql.NullInt64
		if err := rows.Scan(&r.Subject, &r.Allowed, &budget, &r.ChangedBy, &r.ChangedAt); err != nil {
			return nil, err
		}
		if budget.Valid {
			r.Budget = &budget.Int64
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
