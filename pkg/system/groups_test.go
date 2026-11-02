package system

import (
	"context"
	"path/filepath"
	"reflect"
	"testing"
)

func openTestDB(t *testing.T) *DB {
	t.Helper()
	d, err := Open(context.Background(), filepath.Join(t.TempDir(), "system.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return d
}

// SLOP3-007 decision 1: groups nest @admin ⊆ @subscriber ⊆ @member ⊆
// @guest; a store is in @store only.
func TestGroupsOf(t *testing.T) {
	cases := map[string][]string{
		"guest":      {"guest"},
		"member":     {"guest", "member"},
		"subscriber": {"guest", "member", "subscriber"},
		"admin":      {"guest", "member", "subscriber", "admin"},
		"store":      {"store"},
		"":           nil,
		"none":       nil,
	}
	for aud, want := range cases {
		if got := GroupsOf(aud); !reflect.DeepEqual(got, want) {
			t.Errorf("GroupsOf(%q) = %v, want %v", aud, got, want)
		}
	}
	if !InGroup("admin", "@member") || InGroup("member", "@subscriber") || InGroup("store", "@guest") {
		t.Fatal("InGroup disagrees with GroupsOf")
	}
}

// A cell reaches every audience inside its group; the matrix marks it
// effective there.
func TestPolicyThroughGroups(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()
	if err := d.SetPolicy(ctx, "admin", "test", "journal", "sample", "member", true); err != nil {
		t.Fatal(err)
	}
	for aud, want := range map[string]bool{"guest": false, "member": true, "subscriber": true, "admin": true, "store": false} {
		if got := d.Policy(ctx, "journal", "sample", aud); got != want {
			t.Errorf("Policy(sample, %s) = %v, want %v", aud, got, want)
		}
	}
	cells, err := d.PolicyMatrix(ctx, "journal", []string{"sample"})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range cells {
		if want := InGroup(c.Audience, "member"); c.Effective != want {
			t.Errorf("cell %s: effective %v, want %v", c.Audience, c.Effective, want)
		}
	}
}

// A person's own row wins, even when off; otherwise the most generous row
// that is on among their groups: no budget beats any budget, a bigger
// budget beats a smaller one, a row that is off adds nothing.
func TestLLMRowThroughGroups(t *testing.T) {
	d := openTestDB(t)
	ctx := context.Background()
	n := func(v int64) *int64 { return &v }
	set := func(subject string, on bool, budget *int64) {
		t.Helper()
		if err := d.SetLLM(ctx, "admin", "test", subject, on, budget); err != nil {
			t.Fatal(err)
		}
	}
	set("@member", true, n(500))
	set("@subscriber", true, n(5000))
	if got := d.LLMFor(ctx, "usr_sam", "subscriber"); !got.Allowed || *got.Budget != 5000 || got.Source != "@subscriber" {
		t.Fatalf("subscriber: %+v", got)
	}
	if got := d.LLMFor(ctx, "usr_mia", "member"); !got.Allowed || *got.Budget != 500 {
		t.Fatalf("member: %+v", got)
	}
	set("@subscriber", false, nil)
	if got := d.LLMFor(ctx, "usr_sam", "subscriber"); !got.Allowed || *got.Budget != 500 || got.Source != "@member" {
		t.Fatalf("an @subscriber row that is off adds nothing: %+v", got)
	}
	set("@admin", true, nil)
	if got := d.LLMFor(ctx, "usr_ana", "admin"); !got.Allowed || got.Budget != nil {
		t.Fatalf("no budget beats any budget: %+v", got)
	}
	set("usr_ana", false, nil)
	if got := d.LLMFor(ctx, "usr_ana", "admin"); got.Allowed {
		t.Fatalf("a person's own row wins, even off: %+v", got)
	}
	if got := d.LLMFor(ctx, "usr_g", "guest"); got.Allowed {
		t.Fatalf("no row for guests: %+v", got)
	}
}
