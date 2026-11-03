// Package commands holds the platform's commands that no domain owns yet
// (SLOP3-010 PR 1): they left pkg/verbs, which is now the table machinery
// only, and move on to their domains (PR 2) and capabilities (PR 4). Each
// file's group function builds its verbs bound to an Env; Install puts them
// in a table.
package commands

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/access"
	capsample "github.com/go-go-golems/slop-computer/pkg/caps/sample"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// groups are the files' group functions, in no particular order (the
// table sorts by name).
var groups = []func(*Env) []*verbs.Verb{
	accessVerbs, actorVerbs, billingVerbs, confirmVerbs, dataVerbs, docsVerbs, evalVerbs,
	filesVerbs, mountVerbs, peopleVerbs, policyVerbs, previewVerbs, storeVerbs,
}

// Verbs builds every command bound to e, and the capabilities' verbs. With
// e nil they can be listed (names, arguments, schemas: the CLI's help) but
// not run.
func Verbs(e *Env) []*verbs.Verb {
	var vs []*verbs.Verb
	for _, g := range groups {
		vs = append(vs, g(e)...)
	}
	return append(vs, capsample.Verbs(sampleDeps(e))...)
}

// Install registers the commands into t and, with an Env, makes it the
// table's store check and t its table.
func Install(t *verbs.Table, e *Env) {
	t.Register(Verbs(e)...)
	if e == nil {
		return
	}
	if e.Confirm == nil {
		e.Confirm = verbs.NewConfirmations()
	}
	e.Verbs = t
	t.Stores = e
}

// Check implements verbs.Stores: p must hold need on the store (it opens
// it, as Run will).
func (e *Env) Check(ctx context.Context, p *access.Principal, id string, need rt.Level, what string) error {
	_, _, err := e.open(ctx, p, id, need, what)
	return err
}

// sampleDeps is what sample.run needs from e (read per call: the model
// backend is set after the host is built).
func sampleDeps(e *Env) capsample.Deps {
	if e == nil {
		return capsample.Deps{}
	}
	d := capsample.Deps{Sys: e.Sys, Backend: func() llm.Backend {
		if e.A == nil {
			return nil
		}
		return e.A.LLM
	}}
	if e.K != nil {
		d.Access = e.K.Access
	}
	return d
}
