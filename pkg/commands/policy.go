package commands

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// declaredPolicyCaps are the policy capabilities an app's current version
// declares: matrix rows appear only for those (guide §8.2).
func (e policyEnv) declaredPolicyCaps(ctx context.Context, app string) ([]string, *apps.Manifest) {
	r, err := e.K.Running(ctx, app)
	if err != nil || r.Manifest == nil {
		return nil, nil
	}
	m := r.Manifest
	var out []string
	for _, c := range policy.PolicyCaps {
		ok := false
		switch c {
		case "assets", "sample":
			ok = m.Caps.Declared[c]
		case "user.email":
			ok = m.Caps.Declared["user"] && m.Caps.Scopes["email"]
		case "fetch":
			ok = len(m.Slop.Fetch) > 0
		case "secrets":
			ok = len(m.Slop.Secrets) > 0
		case "platform":
			ok = len(m.Slop.Platform) > 0
		case "stores":
			ok = m.Caps.Stores != rt.LevelNone // capabilities.db.stores (SLOP3-008)
		}
		if ok {
			out = append(out, c)
		}
	}
	return out, m
}

func onOff(s string) (bool, error) {
	switch strings.ToLower(s) {
	case "on", "true", "yes", "1":
		return true, nil
	case "off", "false", "no", "0":
		return false, nil
	}
	return false, errors.New("say on or off")
}

func policyVerbs(e policyEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[PolicyLsIn, any]{Name: "policy.ls", Doc: "Show an app's policy matrix: which policy capabilities each audience may use.", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in PolicyLsIn) (any, error) {
				ctx := req.Context
				caps, m := e.declaredPolicyCaps(ctx, in.App)
				if m == nil {
					return nil, verbs.Errf("not_found", "%s is not an app (no app.json)", in.App)
				}
				cells, err := e.K.Gov.PolicyMatrix(ctx, in.App, caps)
				return map[string]any{"app": in.App, "declared": caps, "cells": cells}, err
			}}.Verb(),
		verbs.Def[PolicySetIn, any]{Name: "policy.set", Effect: verbs.EffectGovern, Doc: "Turn a policy cell on or off: app, capability (assets, sample, user.email, fetch, secrets, platform, stores), @audience, on|off.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in PolicySetIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				caps, m := e.declaredPolicyCaps(ctx, in.App)
				if m == nil {
					return nil, verbs.Errf("not_found", "%s is not an app (no app.json)", in.App)
				}
				c := in.Capability
				found := false
				for _, x := range caps {
					found = found || x == c
				}
				if !found {
					return nil, verbs.Errf("invalid_argument", "%s does not declare %s, so it cannot be turned on", in.App, c)
				}
				on, err := onOff(in.Value)
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				aud := strings.TrimPrefix(in.Audience, "@")
				if err := e.K.Gov.SetPolicy(ctx, p.ID(), p.ViaLabel(), in.App, c, aud, on); err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				if e.A != nil {
					e.A.RestartApp(in.App) // actors evaluate use() at start
				}
				return map[string]any{"app": in.App, "capability": c, "audience": aud, "allowed": on}, nil
			}}.Verb(),
		verbs.Def[LlmLsIn, any]{Name: "llm.ls", Doc: "List LLM access rows (people and audience defaults) with their monthly budgets.", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in LlmLsIn) (any, error) {
				ctx := req.Context
				return e.K.Ledger.LLMRows(ctx)
			}}.Verb(),
		verbs.Def[LlmSetIn, any]{Name: "llm.set", Effect: verbs.EffectGovern, Doc: "Give a person (usr_…, vis_…, an email), an audience (@guest, @member, @subscriber, @admin), @store (stores acting on their own) or one store (store:<id>) LLM access on or off, with a monthly token budget.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in LlmSetIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				sub := in.Subject
				switch {
				case sub == string(access.GroupStore):
					// every store acting on its own (alarms, reactors)
				case strings.HasPrefix(sub, "@"):
					if !access.ValidAudience(strings.TrimPrefix(sub, "@")) || sub == "@none" {
						return nil, verbs.Errf("invalid_argument", "audience is @guest, @member, @subscriber, @admin or @store")
					}
				case strings.HasPrefix(sub, "store:"):
					// one store's own budget, for its alarms and reactors
					if _, err := e.K.Registry.StoreByID(ctx, sub[len("store:"):]); err != nil {
						return nil, verbs.Errf("not_found", "no store %s", sub[len("store:"):])
					}
				default:
					pp, err := e.personArg(ctx, sub)
					if err != nil {
						return nil, err
					}
					sub = pp.ID
				}
				on, err := onOff(in.Value)
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				var budget *int64
				if in.Budget != nil {
					b := or(in.Budget, 0)
					if b < 0 {
						return nil, verbs.Errf("invalid_argument", "a budget is zero or more tokens")
					}
					budget = &b
				}
				if err := e.K.Ledger.SetLLM(ctx, p.ID(), p.ViaLabel(), sub, on, budget); err != nil {
					return nil, err
				}
				return map[string]any{"subject": sub, "allowed": on, "budget": budget}, nil
			}}.Verb(),
		verbs.Def[LlmRmIn, any]{Name: "llm.rm", Effect: verbs.EffectGovern, Doc: "Remove a person's own LLM row (they fall back to their audience's).", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in LlmRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				return map[string]any{"removed": in.Subject}, e.K.Ledger.RemoveLLM(ctx, p.ID(), p.ViaLabel(), in.Subject)
			}}.Verb(),
		verbs.Def[LlmUsageIn, any]{Name: "llm.usage", Doc: "A person's LLM access and usage this month (yours by default).", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in LlmUsageIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				q := p
				if id, ok := strings.CutPrefix(in.Person, "store:"); ok {
					// a store's own budget (alarms, reactors): admins only
					if !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins look at a store's usage")
					}
					q = &access.Principal{Kind: access.KindStore, Store: id}
				} else if s := in.Person; s != "" {
					pp, err := e.personArg(ctx, s)
					if err != nil {
						return nil, err
					}
					if pp.ID != p.ID() && !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins look at other people's usage")
					}
					q = access.PersonPrincipal(pp, "")
				}
				aud := e.K.Access.AudienceOf(ctx, q)
				return map[string]any{"person": q.ID(), "audience": aud, "llm": e.K.Ledger.LLMFor(ctx, q.ID(), string(aud))}, nil
			}}.Verb(),
		verbs.Def[LlmResetIn, any]{Name: "llm.reset", Effect: verbs.EffectGovern, Doc: "Set a person's usage this month to zero.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in LlmResetIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				pp, err := e.personArg(ctx, in.Person)
				if err != nil {
					return nil, err
				}
				return map[string]any{"reset": pp.ID}, e.K.Ledger.ResetLLMUsage(ctx, p.ID(), p.ViaLabel(), pp.ID)
			}}.Verb(),
		verbs.Def[SecretLsIn, any]{Name: "secret.ls", Doc: "List an app's secret names (never values).", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in SecretLsIn) (any, error) {
				ctx := req.Context
				return e.K.Gov.SecretNames(ctx, in.App)
			}}.Verb(),
		verbs.Def[SecretSetIn, any]{Name: "secret.set", Effect: verbs.EffectGovern, Doc: "Set an app's secret (encrypted at rest); the actor reads it if app.json slop.secrets lists it and the policy allows.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in SecretSetIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				key, err := e.Cfg.Key()
				if err != nil {
					return nil, err
				}
				if err := e.K.Gov.SetSecret(ctx, key, p.ID(), p.ViaLabel(), in.App, in.Name, in.Value); err != nil {
					return nil, err
				}
				return map[string]any{"app": in.App, "name": in.Name, "length": strconv.Itoa(len(in.Value))}, nil
			}}.Verb(),
		verbs.Def[SecretRmIn, any]{Name: "secret.rm", Effect: verbs.EffectGovern, Doc: "Remove an app's secret.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in SecretRmIn) (any, error) {
				ctx := req.Context
				p := req.Principal
				err := e.K.Gov.RemoveSecret(ctx, p.ID(), p.ViaLabel(), in.App, in.Name)
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no secret %s on %s", in.Name, in.App)
				}
				return map[string]any{"removed": in.Name}, err
			}}.Verb(),
	}
}

// PolicyLsIn is policy.ls's input.
type PolicyLsIn struct {
	App string `json:"app" slop:"pos=1"`
}

// PolicySetIn is policy.set's input.
type PolicySetIn struct {
	App        string `json:"app" slop:"pos=1"`
	Capability string `json:"capability" slop:"pos=2"`
	Audience   string `json:"audience" slop:"pos=3"`
	Value      string `json:"value" slop:"pos=4"`
}

// LlmLsIn is llm.ls's input.
type LlmLsIn struct {
}

// LlmSetIn is llm.set's input.
type LlmSetIn struct {
	Subject string `json:"subject" slop:"pos=1"`
	Value   string `json:"value" slop:"pos=2"`
	Budget  *int64 `json:"budget,omitempty" jsonschema_description:"tokens per calendar month (omit: no limit)"`
}

// LlmRmIn is llm.rm's input.
type LlmRmIn struct {
	Subject string `json:"subject" slop:"pos=1"`
}

// LlmUsageIn is llm.usage's input.
type LlmUsageIn struct {
	Person string `json:"person,omitempty" slop:"pos=1"`
}

// LlmResetIn is llm.reset's input.
type LlmResetIn struct {
	Person string `json:"person" slop:"pos=1"`
}

// SecretLsIn is secret.ls's input.
type SecretLsIn struct {
	App string `json:"app" slop:"pos=1"`
}

// SecretSetIn is secret.set's input.
type SecretSetIn struct {
	App   string `json:"app" slop:"pos=1"`
	Name  string `json:"name" slop:"pos=2"`
	Value string `json:"value" slop:"pos=3"`
}

// SecretRmIn is secret.rm's input.
type SecretRmIn struct {
	App  string `json:"app" slop:"pos=1"`
	Name string `json:"name" slop:"pos=2"`
}
