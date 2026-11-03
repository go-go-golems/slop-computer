package verbs

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/apps"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/system"
)

// declaredPolicyCaps are the policy capabilities an app's current version
// declares: matrix rows appear only for those (guide §8.2).
func (e *Env) declaredPolicyCaps(ctx context.Context, app string) ([]string, *apps.Manifest) {
	r, err := e.K.Running(ctx, app)
	if err != nil || r.Manifest == nil {
		return nil, nil
	}
	m := r.Manifest
	var out []string
	for _, c := range system.PolicyCaps {
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

func init() {
	Register(
		&Verb{Name: "policy.ls", Doc: "Show an app's policy matrix: which policy capabilities each audience may use.", Scope: Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "app", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				caps, m := e.declaredPolicyCaps(ctx, a.S("app"))
				if m == nil {
					return nil, Errf("not_found", "%s is not an app (no app.json)", a.S("app"))
				}
				cells, err := e.Sys.PolicyMatrix(ctx, a.S("app"), caps)
				return map[string]any{"app": a.S("app"), "declared": caps, "cells": cells}, err
			}},
		&Verb{Name: "policy.set", Effect: EffectGovern, Doc: "Turn a policy cell on or off: app, capability (assets, sample, user.email, fetch, secrets, platform, stores), @audience, on|off.", Scope: Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "app", Type: "string", Pos: 1, Required: true}, {Name: "capability", Type: "string", Pos: 2, Required: true},
				{Name: "audience", Type: "string", Pos: 3, Required: true}, {Name: "value", Type: "string", Pos: 4, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				caps, m := e.declaredPolicyCaps(ctx, a.S("app"))
				if m == nil {
					return nil, Errf("not_found", "%s is not an app (no app.json)", a.S("app"))
				}
				c := a.S("capability")
				found := false
				for _, x := range caps {
					found = found || x == c
				}
				if !found {
					return nil, Errf("invalid_argument", "%s does not declare %s, so it cannot be turned on", a.S("app"), c)
				}
				on, err := onOff(a.S("value"))
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				aud := strings.TrimPrefix(a.S("audience"), "@")
				if err := e.Sys.SetPolicy(ctx, p.ID(), p.ViaLabel(), a.S("app"), c, aud, on); err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				if e.A != nil {
					e.A.RestartApp(a.S("app")) // actors evaluate use() at start
				}
				if e.PolicyChanged != nil {
					e.PolicyChanged(ctx, a.S("app"))
				}
				return map[string]any{"app": a.S("app"), "capability": c, "audience": aud, "allowed": on}, nil
			}},
		&Verb{Name: "llm.ls", Doc: "List LLM access rows (people and audience defaults) with their monthly budgets.", Scope: Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) { return e.Sys.LLMRows(ctx) }},
		&Verb{Name: "llm.set", Effect: EffectGovern, Doc: "Give a person (usr_…, vis_…, an email), an audience (@guest, @member, @subscriber, @admin), @store (stores acting on their own) or one store (store:<id>) LLM access on or off, with a monthly token budget.", Scope: Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "subject", Type: "string", Pos: 1, Required: true}, {Name: "value", Type: "string", Pos: 2, Required: true},
				{Name: "budget", Type: "int", Doc: "tokens per calendar month (omit: no limit)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				sub := a.S("subject")
				switch {
				case sub == string(access.GroupStore):
					// every store acting on its own (alarms, reactors)
				case strings.HasPrefix(sub, "@"):
					if !access.ValidAudience(strings.TrimPrefix(sub, "@")) || sub == "@none" {
						return nil, Errf("invalid_argument", "audience is @guest, @member, @subscriber, @admin or @store")
					}
				case strings.HasPrefix(sub, "store:"):
					// one store's own budget, for its alarms and reactors
					if _, err := e.Sys.StoreByID(ctx, sub[len("store:"):]); err != nil {
						return nil, Errf("not_found", "no store %s", sub[len("store:"):])
					}
				default:
					pp, err := e.personArg(ctx, sub)
					if err != nil {
						return nil, err
					}
					sub = pp.ID
				}
				on, err := onOff(a.S("value"))
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				var budget *int64
				if a.Has("budget") {
					b := a.I("budget", 0)
					if b < 0 {
						return nil, Errf("invalid_argument", "a budget is zero or more tokens")
					}
					budget = &b
				}
				if err := e.Sys.SetLLM(ctx, p.ID(), p.ViaLabel(), sub, on, budget); err != nil {
					return nil, err
				}
				return map[string]any{"subject": sub, "allowed": on, "budget": budget}, nil
			}},
		&Verb{Name: "llm.rm", Effect: EffectGovern, Doc: "Remove a person's own LLM row (they fall back to their audience's).", Scope: Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "subject", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return map[string]any{"removed": a.S("subject")}, e.Sys.RemoveLLM(ctx, p.ID(), p.ViaLabel(), a.S("subject"))
			}},
		&Verb{Name: "llm.usage", Doc: "A person's LLM access and usage this month (yours by default).", Scope: Read, Action: authz.Account,
			Args: []Arg{{Name: "person", Type: "string", Pos: 1}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				q := p
				if id, ok := strings.CutPrefix(a.S("person"), "store:"); ok {
					// a store's own budget (alarms, reactors): admins only
					if !p.IsAdmin() {
						return nil, Errf("permission_denied", "only admins look at a store's usage")
					}
					q = &access.Principal{Kind: access.KindStore, Store: id}
				} else if s := a.S("person"); s != "" {
					pp, err := e.personArg(ctx, s)
					if err != nil {
						return nil, err
					}
					if pp.ID != p.ID() && !p.IsAdmin() {
						return nil, Errf("permission_denied", "only admins look at other people's usage")
					}
					q = access.PersonPrincipal(pp, "")
				}
				aud := e.K.Access.AudienceOf(ctx, q)
				return map[string]any{"person": q.ID(), "audience": aud, "llm": e.Sys.LLMFor(ctx, q.ID(), string(aud))}, nil
			}},
		&Verb{Name: "llm.reset", Effect: EffectGovern, Doc: "Set a person's usage this month to zero.", Scope: Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "person", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				pp, err := e.personArg(ctx, a.S("person"))
				if err != nil {
					return nil, err
				}
				return map[string]any{"reset": pp.ID}, e.Sys.ResetLLMUsage(ctx, p.ID(), p.ViaLabel(), pp.ID)
			}},
		&Verb{Name: "secret.ls", Doc: "List an app's secret names (never values).", Scope: Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "app", Type: "string", Pos: 1, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return e.Sys.SecretNames(ctx, a.S("app"))
			}},
		&Verb{Name: "secret.set", Effect: EffectGovern, Doc: "Set an app's secret (encrypted at rest); the actor reads it if app.json slop.secrets lists it and the policy allows.", Scope: Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "app", Type: "string", Pos: 1, Required: true}, {Name: "name", Type: "string", Pos: 2, Required: true},
				{Name: "value", Type: "string", Pos: 3, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				key, err := e.Cfg.Key()
				if err != nil {
					return nil, err
				}
				if err := e.Sys.SetSecret(ctx, key, p.ID(), p.ViaLabel(), a.S("app"), a.S("name"), a.S("value")); err != nil {
					return nil, err
				}
				return map[string]any{"app": a.S("app"), "name": a.S("name"), "length": strconv.Itoa(len(a.S("value")))}, nil
			}},
		&Verb{Name: "secret.rm", Effect: EffectGovern, Doc: "Remove an app's secret.", Scope: Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []Arg{{Name: "app", Type: "string", Pos: 1, Required: true}, {Name: "name", Type: "string", Pos: 2, Required: true}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				err := e.Sys.RemoveSecret(ctx, p.ID(), p.ViaLabel(), a.S("app"), a.S("name"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "no secret %s on %s", a.S("name"), a.S("app"))
				}
				return map[string]any{"removed": a.S("name")}, err
			}},
	)
}
