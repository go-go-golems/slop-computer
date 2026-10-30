package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Migration 009 rebuilds users on SQLite (role gains member). Rows that
// refer to users keep pointing at them, and foreign keys are on again.
func TestUsersRebuildKeepsReferences(t *testing.T) {
	if os.Getenv("TEST_DATABASE_URL") != "" {
		t.Skip("SQLite only: Postgres changes the CHECK in place")
	}
	ctx := context.Background()
	s, err := Open(ctx, "sqlite:"+filepath.Join(t.TempDir(), "slop.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err = s.migrate(ctx, "008_live_sites.sql"); err != nil {
		t.Fatal(err)
	}
	u, err := s.UpsertIdentity(ctx, Identity{Issuer: "local", Subject: "ramon", Name: "Ramon"}, RoleAdmin)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := s.CreateSession(ctx, u.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	exp := time.Now().Add(time.Hour)
	secret, _, err := s.CreateToken(ctx, u.ID, "cli", []string{ScopeRead}, &exp)
	if err != nil {
		t.Fatal(err)
	}
	applied, err := s.Migrate(ctx)
	if err != nil || len(applied) == 0 || applied[0] != "009_grants.sql" {
		t.Fatalf("migrate: %v %v", applied, err)
	}
	if _, got, err := s.ResolveSession(ctx, token); err != nil || got.ID != u.ID {
		t.Fatalf("session after the rebuild: %+v %v", got, err)
	}
	if _, got, err := s.ResolveToken(ctx, secret); err != nil || got.ID != u.ID {
		t.Fatalf("token after the rebuild: %+v %v", got, err)
	}
	if u, err = s.SetUserRole(ctx, u.ID, RoleMember); err != nil || u.Role != RoleMember {
		t.Fatalf("member: %+v %v", u, err)
	}
	var on int
	if err = s.DB.QueryRowContext(ctx, `PRAGMA foreign_keys`).Scan(&on); err != nil || on != 1 {
		t.Fatalf("foreign keys after migrating: %d %v", on, err)
	}
	if _, err = s.DB.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,csrf_token,id_token,created_at,last_seen_at,expires_at,absolute_expires_at) VALUES(x'00','usr_nobody','c','',?,?,?,?)`,
		exp, exp, exp, exp); err == nil {
		t.Fatal("a session for nobody was accepted: foreign keys are off")
	}
}

// Visitors unseen for long go, with their sessions, grants and private
// documents; others stay.
func TestSweepVisitors(t *testing.T) {
	ctx := context.Background()
	s, err := Open(ctx, "sqlite:"+filepath.Join(t.TempDir(), "slop.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	if _, err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.CreateArtifact(ctx, "ws", ArtifactInput{Title: "ws", Kind: KindData}, ""); err != nil {
		t.Fatal(err)
	}
	old, _ := s.CreateVisitor(ctx)
	if _, _, err = s.CreateSiteSession(ctx, "site.test", old, ""); err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.RTSetGrant(ctx, "ws", old, "view", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err = s.RTWrite(ctx, "ws", "data/users/"+old+"/a", "data/users/"+old, old, func(*RTDoc) ([]byte, error) { return []byte(`{}`), nil }); err != nil {
		t.Fatal(err)
	}
	before := s.Now
	s.Now = func() time.Time { return before().Add(VisitorIdle + time.Hour) }
	fresh, _ := s.CreateVisitor(ctx)
	n, err := s.SweepVisitors(ctx, VisitorIdle)
	if err != nil || n != 1 {
		t.Fatalf("swept %d %v", n, err)
	}
	if ok, _ := s.TouchVisitor(ctx, old); ok {
		t.Fatal("the old visitor is still there")
	}
	if ok, _ := s.TouchVisitor(ctx, fresh); !ok {
		t.Fatal("the fresh visitor went")
	}
	if gs, _ := s.SubjectGrants(ctx, old); len(gs) != 0 {
		t.Fatalf("grants %v", gs)
	}
	if ds, _ := s.PrivateDocs(ctx, old); len(ds) != 0 {
		t.Fatalf("docs %v", ds)
	}
}
