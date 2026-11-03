package access_test

import (
	"context"
	"fmt"
	"math/rand"
	"path/filepath"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// TestLevelNeverAboveCap checks Level against an independent model of the
// rule (SLOP3-007 phase 2): the max over sources (owner column → owner,
// @admin → admin, matching grants → at most admin), then the min with the
// kind's ceiling (disabled or a token without scopes → none, pending →
// interact). The cases are generated: every role, owner or not, a grant to
// the person or to @member at every level, and several token shapes.
func TestLevelNeverAboveCap(t *testing.T) {
	ctx := context.Background()
	d, err := system.Open(ctx, filepath.Join(t.TempDir(), "system.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	c := &access.Checker{Dir: d}
	admin, _, err := d.SignInUser(ctx, "root@example.com", "", "sub-root", []string{"root@example.com"}, true)
	if err != nil {
		t.Fatal(err)
	}
	roles := []string{system.RolePending, system.RoleMember, system.RoleAdmin, system.RoleDisabled}
	levels := []string{"", "view", "interact", "admin", "owner"}
	tokens := [][]string{nil, {}, {"read"}, {"read", "write"}, {"read", "write", "admin"}}
	r := rand.New(rand.NewSource(7))
	for i := 0; i < 300; i++ {
		email := fmt.Sprintf("p%d@example.com", i)
		p, _, err := d.SignInUser(ctx, email, "", "sub-"+email, nil, true)
		if err != nil {
			t.Fatal(err)
		}
		role := roles[r.Intn(len(roles))]
		if p, err = d.SetRole(ctx, admin.ID, "test", p.ID, role); err != nil {
			t.Fatal(err)
		}
		owns := r.Intn(2) == 0
		owner := admin.ID
		if owns {
			owner = p.ID
		}
		st, err := d.AddStore(ctx, system.StoreRow{ID: fmt.Sprintf("s%d", i), Owner: owner, MadeBy: admin.ID}, "test")
		if err != nil {
			t.Fatal(err)
		}
		grant, toMember := levels[r.Intn(len(levels))], r.Intn(2) == 0
		if grant != "" {
			subject := p.ID
			if toMember {
				subject = "@member"
			}
			if _, err := d.SetGrant(ctx, admin.ID, "test", system.Grant{Store: st.ID, Subject: subject, Level: grant}); err != nil {
				t.Fatal(err)
			}
		}
		pr := access.PersonPrincipal(p, "")
		tok := tokens[r.Intn(len(tokens))]
		if tok != nil {
			pr.Kind, pr.Scopes = access.KindToken, tok
		}

		// The model.
		aud := c.AudienceOf(ctx, pr)
		src := rt.LevelNone
		if owns {
			src = rt.LevelOwner
		}
		if aud == access.AudAdmin {
			src = max(src, rt.LevelAdmin)
		}
		if grant != "" && (!toMember || aud.In(access.GroupMember)) {
			l, _ := rt.ParseLevel(grant)
			src = max(src, min(l, rt.LevelAdmin))
		}
		ceil := rt.LevelOwner
		switch {
		case tok != nil && len(tok) == 0, aud == access.AudNone:
			ceil = rt.LevelNone
		case aud == access.AudGuest:
			ceil = rt.LevelInteract
		}
		want := min(src, ceil)

		got := c.Level(ctx, pr, st)
		if got.Level != want || got.Level > ceil {
			t.Fatalf("case %d: role %s owns %v grant %q to member %v token %v: level %s, want %s\n%v",
				i, role, owns, grant, toMember, tok, got.Level, want, got.Trace)
		}
	}
}
