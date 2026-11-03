package policy

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

func openTestDB(t *testing.T) *Governance {
	t.Helper()
	d, err := sysdb.Open(context.Background(), filepath.Join(t.TempDir(), "system.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	return NewGovernance(d)
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
		if want := sysdb.InGroup(c.Audience, "member"); c.Effective != want {
			t.Errorf("cell %s: effective %v, want %v", c.Audience, c.Effective, want)
		}
	}
}
