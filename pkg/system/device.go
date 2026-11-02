package system

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/go-go-golems/slop/pkg/ids"
)

// DeviceCode is a pending CLI login.
type DeviceCode struct {
	UserCode   string   `json:"userCode"`
	Name       string   `json:"name"`
	Scopes     []string `json:"scopes"`
	Days       int      `json:"days"`
	ApprovedBy string   `json:"approvedBy,omitempty"`
	Denied     bool     `json:"denied"`
	ExpiresAt  int64    `json:"expiresAt"`
}

// DeviceMinutes is how long a device login waits for approval.
const DeviceMinutes = 10

// StartDevice records a device login and returns the device secret.
func (d *DB) StartDevice(ctx context.Context, name string, scopes []string, days int) (string, DeviceCode, error) {
	secret := ids.Secret("dev_")
	now := d.NowMs()
	dc := DeviceCode{UserCode: ids.UserCode(), Name: name, Scopes: scopes, Days: days,
		ExpiresAt: now + DeviceMinutes*int64(time.Minute/time.Millisecond)}
	_, err := d.ExecContext(ctx, `INSERT INTO device_codes (device_hash, user_code, name, scopes, days, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		ids.Hash(secret), dc.UserCode, name, strings.Join(scopes, " "), days, now, dc.ExpiresAt)
	return secret, dc, err
}

func scanDevice(row interface{ Scan(...any) error }) (DeviceCode, error) {
	var dc DeviceCode
	var scopes string
	var by sql.NullString
	err := row.Scan(&dc.UserCode, &dc.Name, &scopes, &dc.Days, &by, &dc.Denied, &dc.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return dc, ErrNotFound
	}
	dc.Scopes = splitScopes(scopes)
	dc.ApprovedBy = by.String
	return dc, err
}

const deviceCols = `user_code, name, scopes, days, approved_by, denied, expires_at`

// DeviceByUserCode returns a live device login by the code people type.
func (d *DB) DeviceByUserCode(ctx context.Context, code string) (DeviceCode, error) {
	dc, err := scanDevice(d.QueryRowContext(ctx, `SELECT `+deviceCols+` FROM device_codes WHERE user_code = ? AND expires_at > ?`,
		strings.ToUpper(strings.TrimSpace(code)), d.NowMs()))
	return dc, err
}

// ApproveDevice approves (with a token made for person) or denies a device login.
func (d *DB) ApproveDevice(ctx context.Context, code, person string, scopes []string, days int, deny bool) error {
	dc, err := d.DeviceByUserCode(ctx, code)
	if err != nil {
		return err
	}
	if dc.ApprovedBy != "" || dc.Denied {
		return errors.New("this login was already decided")
	}
	if deny {
		_, err := d.ExecContext(ctx, `UPDATE device_codes SET denied = 1 WHERE user_code = ?`, dc.UserCode)
		return err
	}
	secret, tok, err := d.CreateToken(ctx, person, dc.Name, scopes, days)
	if err != nil {
		return err
	}
	_, err = d.ExecContext(ctx, `UPDATE device_codes SET approved_by = ?, token_id = ?, token_plain = ? WHERE user_code = ?`,
		person, tok.ID, secret, dc.UserCode)
	return err
}

// ErrPending means a device login is not decided yet; ErrDenied that it was refused.
var (
	ErrPending = errors.New("authorization_pending")
	ErrDenied  = errors.New("access_denied")
)

// PollDevice returns the token once a device login is approved. The secret
// is handed out exactly once.
func (d *DB) PollDevice(ctx context.Context, deviceSecret string) (string, Token, error) {
	var tokenID, plain sql.NullString
	var denied bool
	var exp int64
	err := d.QueryRowContext(ctx, `SELECT token_id, token_plain, denied, expires_at FROM device_codes WHERE device_hash = ?`,
		ids.Hash(deviceSecret)).Scan(&tokenID, &plain, &denied, &exp)
	if errors.Is(err, sql.ErrNoRows) {
		return "", Token{}, ErrNotFound
	}
	if err != nil {
		return "", Token{}, err
	}
	switch {
	case denied:
		return "", Token{}, ErrDenied
	case !tokenID.Valid && exp <= d.NowMs():
		return "", Token{}, ErrNotFound
	case !tokenID.Valid:
		return "", Token{}, ErrPending
	case !plain.Valid:
		return "", Token{}, ErrNotFound // already collected
	}
	if _, err := d.ExecContext(ctx, `UPDATE device_codes SET token_plain = NULL WHERE device_hash = ?`, ids.Hash(deviceSecret)); err != nil {
		return "", Token{}, err
	}
	t, err := d.Token(ctx, tokenID.String)
	return plain.String, t, err
}
