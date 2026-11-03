package identity

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// LoginFlow is an OIDC sign-in in progress.
type LoginFlow struct {
	BindingHash string
	Nonce       string
	Verifier    string
	ReturnPath  string
}

// SaveLoginFlow records a flow under its state for ttl.
func (d *Accounts) SaveLoginFlow(ctx context.Context, state string, f LoginFlow, ttl time.Duration) error {
	now := d.NowMs()
	_, err := d.ExecContext(ctx, `DELETE FROM login_flows WHERE expires_at < ?`, now)
	if err != nil {
		return err
	}
	_, err = d.ExecContext(ctx, `INSERT INTO login_flows (state, binding_hash, nonce, verifier, return_path, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
		state, f.BindingHash, f.Nonce, f.Verifier, f.ReturnPath, now+ttl.Milliseconds())
	return err
}

// ConsumeLoginFlow takes a live flow by state, if bindingHash matches the
// browser that started it. A flow is used once.
func (d *Accounts) ConsumeLoginFlow(ctx context.Context, state, bindingHash string) (LoginFlow, error) {
	var f LoginFlow
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		err := tx.QueryRowContext(ctx, `SELECT binding_hash, nonce, verifier, return_path FROM login_flows WHERE state = ? AND expires_at > ?`,
			state, d.NowMs()).Scan(&f.BindingHash, &f.Nonce, &f.Verifier, &f.ReturnPath)
		if errors.Is(err, sql.ErrNoRows) {
			return sysdb.ErrNotFound
		}
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM login_flows WHERE state = ?`, state); err != nil {
			return err
		}
		if f.BindingHash != bindingHash {
			return sysdb.ErrNotFound
		}
		return nil
	})
	return f, err
}

// LoginFlowReturn is where a flow was going (to restart it), or "/".
func (d *Accounts) LoginFlowReturn(ctx context.Context, state string) string {
	var ret string
	if err := d.QueryRowContext(ctx, `SELECT return_path FROM login_flows WHERE state = ?`, state).Scan(&ret); err != nil {
		return "/"
	}
	return ret
}
