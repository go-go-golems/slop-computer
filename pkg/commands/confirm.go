package commands

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func confirmVerbs(e confirmEnv) []*verbs.Verb {
	return []*verbs.Verb{
		{Name: "confirm.approve", Doc: "Allow a change an app asked to make for you (the id from its confirmation_required error).", Scope: verbs.Write, Action: authz.Account,
			Args: []verbs.Arg{{Name: "id", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				x, ok := e.Confirm.Approve(a.S("id"), p.ID())
				if !ok {
					return nil, verbs.Errf("not_found", "no confirmation %s waits for you", a.S("id"))
				}
				return x, nil
			}},
	}
}
