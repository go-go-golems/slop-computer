package system

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/ids"
)

// Roles of a user. Guests are people of kind guest with role "guest".
const (
	RolePending  = "pending"
	RoleMember   = "member"
	RoleAdmin    = "admin"
	RoleDisabled = "disabled"
	RoleGuest    = "guest"
)

// Person is a user or a guest.
type Person struct {
	ID         string `json:"id"`
	Kind       string `json:"kind"`
	Email      string `json:"email,omitempty"`
	Name       string `json:"name"`
	Role       string `json:"role"`
	CreatedAt  int64  `json:"createdAt"`
	LastSeenAt int64  `json:"lastSeenAt"`
}

const personCols = `id, kind, coalesce(email, ''), name, role, created_at, last_seen_at`

func scanPerson(row interface{ Scan(...any) error }) (Person, error) {
	var p Person
	err := row.Scan(&p.ID, &p.Kind, &p.Email, &p.Name, &p.Role, &p.CreatedAt, &p.LastSeenAt)
	if errors.Is(err, sql.ErrNoRows) {
		return p, ErrNotFound
	}
	return p, err
}

// Person returns one person by id.
func (d *DB) Person(ctx context.Context, id string) (Person, error) {
	return scanPerson(d.QueryRowContext(ctx, `SELECT `+personCols+` FROM people WHERE id = ?`, id))
}

// PersonByEmail returns a user by email (case-insensitive).
func (d *DB) PersonByEmail(ctx context.Context, email string) (Person, error) {
	return scanPerson(d.QueryRowContext(ctx, `SELECT `+personCols+` FROM people WHERE email = ?`, strings.ToLower(strings.TrimSpace(email))))
}

// People lists people of a kind ("" for all), newest first.
func (d *DB) People(ctx context.Context, kind string) ([]Person, error) {
	q := `SELECT ` + personCols + ` FROM people`
	args := []any{}
	if kind != "" {
		q += ` WHERE kind = ?`
		args = append(args, kind)
	}
	q += ` ORDER BY created_at DESC LIMIT 5000`
	rows, err := d.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Person{}
	for rows.Next() {
		p, err := scanPerson(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SignInUser finds or creates the user for a verified email (and OIDC
// subject when there is one). A new user gets role admin when their email is
// in admins, else member (signup open) or pending (signup approval).
func (d *DB) SignInUser(ctx context.Context, email, name, subject string, admins []string, signupOpen bool) (Person, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return Person{}, false, errors.New("an email is required")
	}
	now := d.NowMs()
	var p Person
	created := false
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		p, err = scanPerson(tx.QueryRowContext(ctx, `SELECT `+personCols+` FROM people WHERE email = ?`, email))
		if err == nil {
			if name != "" && p.Name == "" {
				p.Name = name
			}
			_, err = tx.ExecContext(ctx, `UPDATE people SET last_seen_at = ?, name = ?, oidc_subject = coalesce(oidc_subject, ?) WHERE id = ?`,
				now, p.Name, nullStr(subject), p.ID)
			return err
		}
		if !errors.Is(err, ErrNotFound) {
			return err
		}
		role := RolePending
		if signupOpen {
			role = RoleMember
		}
		for _, a := range admins {
			if strings.EqualFold(strings.TrimSpace(a), email) {
				role = RoleAdmin
			}
		}
		if name == "" {
			name = strings.SplitN(email, "@", 2)[0]
		}
		p = Person{ID: ids.New("usr_", 12), Kind: "user", Email: email, Name: name, Role: role, CreatedAt: now, LastSeenAt: now}
		if _, err := tx.ExecContext(ctx, `INSERT INTO people (id, kind, email, oidc_subject, name, role, created_at, last_seen_at) VALUES (?, 'user', ?, ?, ?, ?, ?, ?)`,
			p.ID, email, nullStr(subject), name, role, now, now); err != nil {
			return err
		}
		created = true
		_, err = Log(ctx, tx, now, p.ID, "auth", "signed up as "+role, Change{Kind: "person", Key: p.ID, Op: "create", After: role})
		return err
	})
	return p, created, err
}

// SetRole changes a user's role.
func (d *DB) SetRole(ctx context.Context, actor, via, id, role string) (Person, error) {
	switch role {
	case RolePending, RoleMember, RoleAdmin, RoleDisabled:
	default:
		return Person{}, errors.New("role must be pending, member, admin or disabled")
	}
	var p Person
	err := d.Tx(ctx, func(tx *sql.Tx) error {
		var err error
		p, err = scanPerson(tx.QueryRowContext(ctx, `SELECT `+personCols+` FROM people WHERE id = ?`, id))
		if err != nil {
			return err
		}
		if p.Kind != "user" {
			return errors.New("only users have roles")
		}
		before := p.Role
		if _, err := tx.ExecContext(ctx, `UPDATE people SET role = ? WHERE id = ?`, role, id); err != nil {
			return err
		}
		p.Role = role
		if role == RoleDisabled {
			if _, err := tx.ExecContext(ctx, `DELETE FROM sessions WHERE person = ?`, id); err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE tokens SET revoked_at = ? WHERE person = ? AND revoked_at IS NULL`, d.NowMs(), id); err != nil {
				return err
			}
		}
		_, err = Log(ctx, tx, d.NowMs(), actor, via, "role of "+id+": "+before+" → "+role,
			Change{Kind: "person", Key: id, Op: "role", Before: before, After: role})
		return err
	})
	return p, err
}

// CreateGuest makes a guest person (vis_…).
func (d *DB) CreateGuest(ctx context.Context, ip string) (Person, error) {
	now := d.NowMs()
	p := Person{ID: ids.New("vis_", 12), Kind: "guest", Name: "Guest", Role: RoleGuest, CreatedAt: now, LastSeenAt: now}
	_, err := d.ExecContext(ctx, `INSERT INTO people (id, kind, name, role, created_at, last_seen_at, created_ip) VALUES (?, 'guest', 'Guest', 'guest', ?, ?, ?)`,
		p.ID, now, now, ip)
	return p, err
}

// TouchPerson records that a person was seen now.
func (d *DB) TouchPerson(ctx context.Context, id string) {
	_, _ = d.ExecContext(ctx, `UPDATE people SET last_seen_at = ? WHERE id = ?`, d.NowMs(), id)
}
