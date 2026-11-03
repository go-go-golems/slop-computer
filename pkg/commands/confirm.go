package commands

import (
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func confirmVerbs(e confirmEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[ConfirmApproveIn, *verbs.Confirmation]{Name: "confirm.approve", Doc: "Allow a change an app asked to make for you (the id from its confirmation_required error).", Scope: verbs.Write, Action: authz.Account,
			Run: func(req verbs.Req, in ConfirmApproveIn) (*verbs.Confirmation, error) {
				p := req.Principal
				x, ok := e.Confirm.Approve(in.ID, p.ID())
				if !ok {
					return nil, verbs.Errf("not_found", "no confirmation %s waits for you", in.ID)
				}
				return x, nil
			}}.Verb(),
	}
}

// ConfirmApproveIn is confirm.approve's input.
type ConfirmApproveIn struct {
	ID string `json:"id" slop:"pos=1"`
}
