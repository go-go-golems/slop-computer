package store

import (
	"context"
	"database/sql"
	"time"
)

type auditTokenKey struct{}
type auditViaKey struct{}

// WithAuditToken marks ctx as acting through a personal API token, so audit
// rows written with it record the token. The HTTP layer sets it.
func WithAuditToken(ctx context.Context, tokenID string) context.Context {
	return context.WithValue(ctx, auditTokenKey{}, tokenID)
}

// WithAuditVia names the channel a change came through: "browser", a token's
// name, or a tool ("tool board@1").
func WithAuditVia(ctx context.Context, via string) context.Context {
	return context.WithValue(ctx, auditViaKey{}, via)
}

// AuditToken is the token ID set on ctx, or "".
func AuditToken(ctx context.Context) string { id, _ := ctx.Value(auditTokenKey{}).(string); return id }

// AuditVia is the channel set on ctx, or "".
func AuditVia(ctx context.Context) string { v, _ := ctx.Value(auditViaKey{}).(string); return v }

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// Audit records an action with a nonsecret summary.
func (s *Store) Audit(ctx context.Context, actor, action, subject string, summary map[string]any) error {
	return audit(ctx, s.db(), s.Now(), actor, action, subject, summary)
}

func audit(ctx context.Context, d db, now time.Time, actor, action, subject string, summary map[string]any) error {
	if summary == nil {
		summary = map[string]any{}
	}
	_, err := d.exec(ctx, `INSERT INTO audit(actor_id,token_id,via,action,subject,summary,created_at) VALUES(?,?,?,?,?,?,?)`,
		nullable(actor), nullable(AuditToken(ctx)), AuditVia(ctx), action, subject, MustJSON(summary), now)
	return err
}

type AuditEntry struct {
	ID        int64     `json:"id"`
	ActorID   *string   `json:"actor"`
	TokenID   *string   `json:"tokenId,omitempty"`
	Via       string    `json:"via"`
	Action    string    `json:"action"`
	Subject   string    `json:"subject"`
	Summary   JSON      `json:"summary"`
	CreatedAt time.Time `json:"at"`
}

// AuditFilter selects audit entries; empty fields match everything. Before
// pages backwards: entries with an ID below it.
type AuditFilter struct {
	Subject, Actor, Action string
	Before                 int64
	Limit                  int
}

func (s *Store) AuditQuery(ctx context.Context, f AuditFilter) ([]AuditEntry, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	rows, err := s.db().query(ctx, `SELECT id,actor_id,token_id,via,action,subject,summary,created_at FROM audit
WHERE (?='' OR subject=?) AND (?='' OR actor_id=?) AND (?='' OR action=?) AND (?=0 OR id<?)
ORDER BY id DESC LIMIT ?`, f.Subject, f.Subject, f.Actor, f.Actor, f.Action, f.Action, f.Before, f.Before, f.Limit)
	return scanAll(rows, err, func(r *sql.Rows) (AuditEntry, error) {
		var e AuditEntry
		err := r.Scan(&e.ID, &e.ActorID, &e.TokenID, &e.Via, &e.Action, &e.Subject, &e.Summary, &e.CreatedAt)
		return e, err
	})
}
