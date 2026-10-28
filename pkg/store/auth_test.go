package store_test

import (
	"context"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/go-go-golems/slop-computer/pkg/store/storetest"
	"github.com/pkg/errors"
)

func TestUsersSessionsTokens(t *testing.T) {
	ctx := context.Background()
	s := storetest.Open(t)

	u, err := s.UpsertIdentity(ctx, store.Identity{Issuer: "local", Subject: "manuel", Name: "manuel"}, store.RolePending)
	if err != nil || u.Role != store.RolePending {
		t.Fatalf("upsert %+v %v", u, err)
	}
	again, err := s.UpsertIdentity(ctx, store.Identity{Issuer: "local", Subject: "manuel", Name: "Manuel"}, store.RoleAdmin)
	if err != nil || again.ID != u.ID || again.Role != store.RolePending || again.DisplayName != "Manuel" {
		t.Fatalf("a login must not change the role: %+v %v", again, err)
	}
	if u, err = s.SetUserRole(ctx, u.ID, store.RoleAdmin); err != nil || u.Role != store.RoleAdmin {
		t.Fatalf("promote %+v %v", u, err)
	}

	token, sess, err := s.CreateSession(ctx, u.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	got, gu, err := s.ResolveSession(ctx, token)
	if err != nil || got.CSRF != sess.CSRF || gu.ID != u.ID {
		t.Fatalf("resolve session %+v %+v %v", got, gu, err)
	}

	exp := time.Now().Add(time.Hour)
	secret, tok, err := s.CreateToken(ctx, u.ID, "cli", []string{store.ScopeRead, store.ScopeWrite}, &exp)
	if err != nil || !tok.Allows(store.ScopeRead) || tok.Allows(store.ScopeAdmin) {
		t.Fatalf("create token %+v %v", tok, err)
	}
	rt, ru, err := s.ResolveToken(ctx, secret)
	if err != nil || rt.ID != tok.ID || ru.ID != u.ID || len(rt.Scopes) != 2 {
		t.Fatalf("resolve token %+v %v", rt, err)
	}

	// Demotion revokes sessions and tokens.
	if _, err = s.SetUserRole(ctx, u.ID, store.RoleDisabled); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.ResolveSession(ctx, token); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("session after disable: %v", err)
	}
	if _, _, err = s.ResolveToken(ctx, secret); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("token after disable: %v", err)
	}

	if err = s.Audit(store.WithAuditVia(ctx, "browser"), u.ID, "user.role", u.ID, map[string]any{"role": "disabled"}); err != nil {
		t.Fatal(err)
	}
	entries, err := s.AuditQuery(ctx, store.AuditFilter{Actor: u.ID})
	if err != nil || len(entries) != 1 || entries[0].Via != "browser" {
		t.Fatalf("audit %+v %v", entries, err)
	}
}

func TestDeviceLogin(t *testing.T) {
	ctx := context.Background()
	s := storetest.Open(t)
	u, _ := s.UpsertIdentity(ctx, store.Identity{Issuer: "local", Subject: "ramon"}, store.RoleAdmin)
	if err := s.CreateDeviceAuthorization(ctx, "dev1", "BCDFGHJK", store.DeviceAuthorization{Origin: "http://x", ClientName: "cli", RequestedScopes: []string{"read"}, RequestedDays: 30, Interval: 0}); err != nil {
		t.Fatal(err)
	}
	grant := func(u store.User, scopes []string, days int) ([]string, *time.Time, error) { return scopes, nil, nil }
	if p, err := s.PollDevice(ctx, "dev1", "http://x", grant); err != nil || p.State != store.DevicePending {
		t.Fatalf("pending %+v %v", p, err)
	}
	if err := s.ApproveDevice(ctx, "BCDFGHJK", "http://x", u.ID, []string{"read", "write"}, 30); err != nil {
		t.Fatal(err)
	}
	p, err := s.PollDevice(ctx, "dev1", "http://x", grant)
	if err != nil || p.State != store.DeviceIssued || p.Secret == "" || len(p.Token.Scopes) != 2 {
		t.Fatalf("issued %+v %v", p, err)
	}
	if p, _ = s.PollDevice(ctx, "dev1", "http://x", grant); p.State != store.DeviceExpired {
		t.Fatalf("second poll must not issue again: %+v", p)
	}
}

func TestMigrationsMatch(t *testing.T) {
	pg, err := store.Migrations(store.Postgres)
	if err != nil {
		t.Fatal(err)
	}
	sq, err := store.Migrations(store.SQLite)
	if err != nil {
		t.Fatal(err)
	}
	if len(pg) != len(sq) {
		t.Fatalf("postgres %v sqlite %v", pg, sq)
	}
	for i := range pg {
		if pg[i] != sq[i] {
			t.Fatalf("postgres %v sqlite %v", pg, sq)
		}
	}
}
