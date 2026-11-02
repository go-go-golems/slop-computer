package system

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"errors"
	"time"
)

// --- the app policy matrix (guide §8) --------------------------------------------

// PolicyCaps are the capabilities the policy controls; everything else an
// app declares is always on.
var PolicyCaps = []string{"assets", "sample", "user.email", "fetch", "secrets", "platform"}

// PolicyAudiences are the matrix's columns.
var PolicyAudiences = []string{"guest", "member", "subscriber", "admin"}

// GroupsOf is the one place group nesting is decided (SLOP3-007 decision
// 1): @admin ⊆ @subscriber ⊆ @member ⊆ @guest, so an audience's groups are
// it and every audience below it. "store" (a store acting on its own) is a
// group of its own, inside none of the others. Every "is this person in
// this class?" question reads this, never a rank.
func GroupsOf(audience string) []string {
	switch audience {
	case "guest":
		return []string{"guest"}
	case "member":
		return []string{"guest", "member"}
	case "subscriber":
		return []string{"guest", "member", "subscriber"}
	case "admin":
		return []string{"guest", "member", "subscriber", "admin"}
	case "store":
		return []string{"store"}
	}
	return nil
}

// InGroup reports whether an audience's groups include group (with or
// without its "@").
func InGroup(audience, group string) bool {
	if len(group) > 0 && group[0] == '@' {
		group = group[1:]
	}
	for _, g := range GroupsOf(audience) {
		if g == group {
			return true
		}
	}
	return false
}

// DefaultPolicy is a cell without a row: assets for members and up, the
// rest off.
func DefaultPolicy(capability, audience string) bool {
	return capability == "assets" && audience != "guest"
}

// IsPolicyCap reports a capability the matrix controls.
func IsPolicyCap(c string) bool {
	for _, x := range PolicyCaps {
		if x == c {
			return true
		}
	}
	return false
}

// Policy answers whether app may use capability for someone in audience:
// on when the cell of any of the audience's groups is on (a cell on for
// @member reaches subscribers and admins). A group without a row has the
// default cell.
func (d *DB) Policy(ctx context.Context, app, capability, audience string) bool {
	for _, g := range GroupsOf(audience) {
		if d.policyCell(ctx, app, capability, g) {
			return true
		}
	}
	return false
}

// policyCell is one stored cell, or its default.
func (d *DB) policyCell(ctx context.Context, app, capability, group string) bool {
	var allowed bool
	err := d.QueryRowContext(ctx, `SELECT allowed FROM app_policy WHERE app = ? AND capability = ? AND audience = ?`, app, capability, group).Scan(&allowed)
	if errors.Is(err, sql.ErrNoRows) {
		return DefaultPolicy(capability, group)
	}
	return err == nil && allowed
}

// PolicyCell is one cell of an app's matrix.
type PolicyCell struct {
	Capability string `json:"capability"`
	Audience   string `json:"audience"`
	Allowed    bool   `json:"allowed"`
	Default    bool   `json:"default"`   // no row: the default applies
	Effective  bool   `json:"effective"` // on for this audience, through its own cell or a group it is inside
}

// PolicyMatrix returns an app's cells for the capabilities given.
func (d *DB) PolicyMatrix(ctx context.Context, app string, caps []string) ([]PolicyCell, error) {
	rows, err := d.QueryContext(ctx, `SELECT capability, audience, allowed FROM app_policy WHERE app = ?`, app)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	set := map[string]bool{}
	for rows.Next() {
		var c, a string
		var ok bool
		if err := rows.Scan(&c, &a, &ok); err != nil {
			return nil, err
		}
		set[c+"/"+a] = ok
	}
	out := []PolicyCell{}
	for _, c := range caps {
		for _, a := range PolicyAudiences {
			v, ok := set[c+"/"+a]
			if !ok {
				v = DefaultPolicy(c, a)
			}
			out = append(out, PolicyCell{Capability: c, Audience: a, Allowed: v, Default: !ok})
		}
	}
	// A cell is in effect when it or the cell of any group the audience is
	// inside is on (Policy's rule).
	on := map[string]bool{}
	for _, c := range out {
		on[c.Capability+"/"+c.Audience] = c.Allowed
	}
	for i, c := range out {
		for _, g := range GroupsOf(c.Audience) {
			if on[c.Capability+"/"+g] {
				out[i].Effective = true
			}
		}
	}
	return out, rows.Err()
}

// SetPolicy turns a cell on or off.
func (d *DB) SetPolicy(ctx context.Context, actor, via, app, capability, audience string, allowed bool) error {
	if !IsPolicyCap(capability) {
		return errors.New("the policy controls assets, sample, user.email, fetch, secrets and platform")
	}
	ok := false
	for _, a := range PolicyAudiences {
		ok = ok || a == audience
	}
	if !ok {
		return errors.New("audience is guest, member, subscriber or admin")
	}
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		if _, err := tx.ExecContext(ctx, `INSERT INTO app_policy (app, capability, audience, allowed, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (app, capability, audience) DO UPDATE SET allowed = excluded.allowed, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
			app, capability, audience, allowed, actor, now); err != nil {
			return err
		}
		onoff := map[bool]string{true: "on", false: "off"}[allowed]
		_, err := Log(ctx, tx, now, actor, via, "policy "+app+" "+capability+" @"+audience+" "+onoff,
			Change{Kind: "policy", Key: app + " " + capability + " " + audience, Op: "set", After: onoff})
		return err
	})
}

// --- LLM access and monthly budgets (guide §9) ------------------------------------

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

func (d *DB) llmRow(ctx context.Context, subject string) (LLMRow, bool) {
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
func (d *DB) LLMFor(ctx context.Context, person, audience string) LLM {
	row, ok := d.llmRow(ctx, person)
	if !ok {
		row, ok = d.groupLLMRow(ctx, audience)
	}
	if !ok || !row.Allowed || person == "" {
		return LLM{}
	}
	out := LLM{Allowed: true, Budget: row.Budget, Used: d.LLMUsed(ctx, person, Period(time.Now())), Source: row.Subject}
	if row.Budget != nil {
		rem := max(0, *row.Budget-out.Used)
		out.Remaining = &rem
	}
	return out
}

// groupLLMRow is the most generous row that is on among an audience's
// groups.
func (d *DB) groupLLMRow(ctx context.Context, audience string) (LLMRow, bool) {
	var best LLMRow
	found := false
	for _, g := range GroupsOf(audience) {
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
func (d *DB) LLMUsed(ctx context.Context, person, period string) int64 {
	var n int64
	_ = d.QueryRowContext(ctx, `SELECT used_tokens FROM llm_usage WHERE person = ? AND period = ?`, person, period).Scan(&n)
	return n
}

// AddLLMUsage charges tokens to a person's current month.
func (d *DB) AddLLMUsage(ctx context.Context, person string, tokens int64) error {
	now := time.Now()
	_, err := d.ExecContext(ctx, `INSERT INTO llm_usage (person, period, used_tokens, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT (person, period) DO UPDATE SET used_tokens = used_tokens + excluded.used_tokens, updated_at = excluded.updated_at`,
		person, Period(now), tokens, now.UnixMilli())
	return err
}

// ResetLLMUsage sets a person's current month to zero.
func (d *DB) ResetLLMUsage(ctx context.Context, actor, via, person string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := time.Now()
		if _, err := tx.ExecContext(ctx, `UPDATE llm_usage SET used_tokens = 0, updated_at = ? WHERE person = ? AND period = ?`, now.UnixMilli(), person, Period(now)); err != nil {
			return err
		}
		_, err := Log(ctx, tx, now.UnixMilli(), actor, via, "reset LLM usage of "+person, Change{Kind: "llm", Key: person, Op: "reset"})
		return err
	})
}

// SetLLM writes a subject's access: a person (usr_…, vis_…) or an
// audience (@guest, @member, @subscriber, @admin).
func (d *DB) SetLLM(ctx context.Context, actor, via, subject string, allowed bool, budget *int64) error {
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
		_, err := Log(ctx, tx, now, actor, via, "llm "+subject+" "+map[bool]string{true: "on", false: "off"}[allowed],
			Change{Kind: "llm", Key: subject, Op: "set"})
		return err
	})
}

// RemoveLLM deletes a subject's row (a person falls back to their audience).
func (d *DB) RemoveLLM(ctx context.Context, actor, via, subject string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM llm_access WHERE subject = ?`, subject); err != nil {
			return err
		}
		_, err := Log(ctx, tx, d.NowMs(), actor, via, "llm "+subject+" removed", Change{Kind: "llm", Key: subject, Op: "remove"})
		return err
	})
}

// LLMRows lists llm_access with this month's usage of the people in it.
func (d *DB) LLMRows(ctx context.Context) ([]LLMRow, error) {
	rows, err := d.QueryContext(ctx, `SELECT subject, allowed, budget_tokens, coalesce(changed_by, ''), changed_at FROM llm_access ORDER BY subject`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
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

// --- secrets (encrypted with a key derived from the server key) ----------------------

func secretAEAD(serverKey []byte) (cipher.AEAD, error) {
	m := hmac.New(sha256.New, serverKey)
	m.Write([]byte("slop secrets v1"))
	block, err := aes.NewCipher(m.Sum(nil))
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// SetSecret stores an app's secret, sealed with AES-GCM (the app and name
// are bound as associated data).
func (d *DB) SetSecret(ctx context.Context, serverKey []byte, actor, via, app, name, value string) error {
	aead, err := secretAEAD(serverKey)
	if err != nil {
		return err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	sealed := aead.Seal(nonce, nonce, []byte(value), []byte(app+"\x00"+name))
	return d.Tx(ctx, func(tx *sql.Tx) error {
		now := d.NowMs()
		if _, err := tx.ExecContext(ctx, `INSERT INTO secrets (app, name, value_enc, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (app, name) DO UPDATE SET value_enc = excluded.value_enc, changed_by = excluded.changed_by, changed_at = excluded.changed_at`,
			app, name, sealed, actor, now); err != nil {
			return err
		}
		_, err := Log(ctx, tx, now, actor, via, "secret "+name+" of "+app+" set", Change{Kind: "secret", Key: app + " " + name, Op: "set"})
		return err
	})
}

// Secret opens an app's secret.
func (d *DB) Secret(ctx context.Context, serverKey []byte, app, name string) (string, error) {
	var sealed []byte
	if err := d.QueryRowContext(ctx, `SELECT value_enc FROM secrets WHERE app = ? AND name = ?`, app, name).Scan(&sealed); errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	} else if err != nil {
		return "", err
	}
	aead, err := secretAEAD(serverKey)
	if err != nil {
		return "", err
	}
	if len(sealed) < aead.NonceSize() {
		return "", errors.New("secret is damaged")
	}
	plain, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte(app+"\x00"+name))
	if err != nil {
		return "", errors.New("secret cannot be opened with this server key")
	}
	return string(plain), nil
}

// SecretNames lists an app's secret names (never values).
func (d *DB) SecretNames(ctx context.Context, app string) ([]map[string]any, error) {
	rows, err := d.QueryContext(ctx, `SELECT name, coalesce(changed_by, ''), changed_at FROM secrets WHERE app = ? ORDER BY name`, app)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var n, by string
		var at int64
		if err := rows.Scan(&n, &by, &at); err != nil {
			return nil, err
		}
		out = append(out, map[string]any{"name": n, "changedBy": by, "changedAt": at})
	}
	return out, rows.Err()
}

// RemoveSecret deletes an app's secret.
func (d *DB) RemoveSecret(ctx context.Context, actor, via, app, name string) error {
	return d.Tx(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `DELETE FROM secrets WHERE app = ? AND name = ?`, app, name)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return ErrNotFound
		}
		_, err = Log(ctx, tx, d.NowMs(), actor, via, "secret "+name+" of "+app+" removed", Change{Kind: "secret", Key: app + " " + name, Op: "remove"})
		return err
	})
}
