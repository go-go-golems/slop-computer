package kernel

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
)

// Open is the checked way from a principal to a store's data: p must hold
// need on store id (what names the use, for the decision's trace), and
// then the store is opened. hidden makes a refusal read as not_found.
//
// A refusal is not an error: it returns a nil store and the decision (its
// Code and Trace say why), and the caller words it for its door. Store,
// unchecked, is for the kernel's own work and for code that already holds
// a decided level (a view, an actor's own store).
func (k *Kernel) Open(ctx context.Context, p *access.Principal, id string, need rt.Level, what string, hidden bool) (*store.Store, access.Decision, error) {
	d, _, err := k.Access.Can(ctx, p, id, need, what, hidden)
	if err != nil || !d.OK {
		return nil, d, err
	}
	s, err := k.Store(ctx, id)
	return s, d, err
}
