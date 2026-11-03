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
)

// --- the app policy matrix (guide §8) --------------------------------------------

// PolicyCaps are the capabilities the policy controls; everything else an
// app declares is always on.
var PolicyCaps = []string{"assets", "sample", "user.email", "fetch", "secrets", "platform", "stores"}

// PolicyAudiences are the matrix's columns: the person groups, then
// "store", a store acting on its own (alarms, reactors; SLOP3-007).
var PolicyAudiences = []string{"guest", "member", "subscriber", "admin", "store"}

// DefaultPolicy is a cell without a row: assets for members and up, the
// rest off (and off for stores acting on their own).
func DefaultPolicy(capability, audience string) bool {
	return capability == "assets" && InGroup(audience, "member")
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
		return errors.New("audience is guest, member, subscriber, admin or store")
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
