package kernel

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// VisibleStores lists what p owns or holds a grant on.
func (k *Kernel) VisibleStores(ctx context.Context, p *access.Principal) ([]sysdb.StoreRow, error) {
	aud := k.Access.AudienceOf(ctx, p)
	subjects := []string{}
	if id := p.ID(); id != "" {
		subjects = append(subjects, id)
	}
	for _, s := range []string{"@guest", "@member", "@subscriber"} {
		if access.Matches(s, p, aud) {
			subjects = append(subjects, s)
		}
	}
	seen := map[string]bool{}
	out := []sysdb.StoreRow{}
	if p.ID() != "" {
		owned, err := k.Registry.Stores(ctx, p.ID())
		if err != nil {
			return nil, err
		}
		for _, r := range owned {
			seen[r.ID] = true
			out = append(out, r)
		}
	}
	granted, err := k.Registry.StoresGranted(ctx, subjects)
	if err != nil {
		return nil, err
	}
	for _, r := range granted {
		if !seen[r.ID] {
			out = append(out, r)
		}
	}
	return out, nil
}
