// Package commands holds the platform's commands that no domain owns yet
// (SLOP3-010 PR 1): they left pkg/verbs, which is now the table machinery
// only, and move on to their domains (PR 2) and capabilities (PR 4). Each
// file's group function builds its verbs bound to an Env; Install puts them
// in a table.
package commands

import (
	"context"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	capsample "github.com/go-go-golems/slop-computer/pkg/caps/sample"
	"github.com/go-go-golems/slop-computer/pkg/config"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Verbs builds every command, each group bound to only what it uses (its
// xEnv in env.go), and the capabilities' verbs. With e nil they can be
// listed (names, arguments, schemas: the CLI's help) but not run.
func Verbs(e *Env) []*verbs.Verb {
	var (
		k       kernelEnv
		cfg     *config.Config
		a       *actor.Manager
		confirm *verbs.Confirmations
		table   *verbs.Table
		people  peopleEnv
	)
	if e != nil {
		k, cfg, a, confirm, table = kernelEnv{K: e.K}, e.Cfg, e.A, e.Confirm, e.Verbs
		if e.K != nil {
			people = peopleEnv{People: e.K.People, Sys: e.K.Sys}
		}
	}
	// The Stripe service is installed after the commands (SetBilling).
	service := func() *stripe.Service {
		if e == nil {
			return nil
		}
		return e.Billing
	}
	groups := [][]*verbs.Verb{
		accessVerbs(k), actorVerbs(actorEnv{k, a}), billingVerbs(billingEnv{k, cfg, service}),
		confirmVerbs(confirmEnv{confirm}), dataVerbs(k), docsVerbs(k), evalVerbs(evalEnv{table}),
		filesVerbs(k), mountVerbs(mountEnv{k, cfg, a}), peopleVerbs(people),
		policyVerbs(policyEnv{k, cfg, a}), previewVerbs(previewEnv{k, cfg}), storeVerbs(k),
	}
	var vs []*verbs.Verb
	for _, g := range groups {
		vs = append(vs, g...)
	}
	return append(vs, capsample.Verbs(sampleDeps(e))...)
}

// Install registers the commands into t and, with an Env, makes it the
// table's store check and t its table.
func Install(t *verbs.Table, e *Env) {
	// The groups capture these when they are built, so they are set first.
	if e != nil {
		if e.Confirm == nil {
			e.Confirm = verbs.NewConfirmations()
		}
		e.Verbs = t
		t.Stores = e
	}
	t.Register(Verbs(e)...)
}

// Check implements verbs.Stores: p must hold need on the store (it opens
// it, as Run will).
func (e *Env) Check(ctx context.Context, p *access.Principal, id string, need rt.Level, what string) error {
	_, _, err := kernelEnv{K: e.K}.open(ctx, p, id, need, what)
	return err
}

// sampleDeps is what sample.run needs from e (read per call: the model
// backend is set after the host is built).
func sampleDeps(e *Env) capsample.Deps {
	if e == nil {
		return capsample.Deps{}
	}
	d := capsample.Deps{Backend: func() llm.Backend {
		if e.A == nil {
			return nil
		}
		return e.A.LLM
	}}
	if e.K != nil {
		d.Access, d.Ledger = e.K.Access, e.K.Ledger
	}
	return d
}
