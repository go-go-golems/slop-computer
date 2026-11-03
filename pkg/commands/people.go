package commands

import (
	"context"
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func peopleVerbs(e peopleEnv) []*verbs.Verb {
	return []*verbs.Verb{
		{Name: "whoami", Doc: "Who this call acts as: person, role, audience, token and scopes.", Scope: verbs.Read, Action: authz.Account,
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				out := map[string]any{"kind": p.Kind, "id": p.ID(), "via": p.ViaLabel()}
				if p.Person != nil {
					out["person"] = p.Person
				}
				if p.TokenID != "" {
					out["token"] = p.TokenID
					out["scopes"] = p.Scopes
				}
				return out, nil
			}},
		{Name: "token.ls", Doc: "List your API tokens (admins: --all for everyone's).", Scope: verbs.Read, Action: authz.Account,
			Args: []verbs.Arg{{Name: "all", Type: "bool", Doc: "every person's tokens (admins)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				who := p.ID()
				if a.B("all") {
					if !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins list everyone's tokens")
					}
					who = ""
				}
				return e.People.Tokens(ctx, who)
			}},
		{Name: "token.new", Doc: "Make an API token; its secret is shown once.", Scope: verbs.Write, Action: authz.Account,
			Args: []verbs.Arg{{Name: "name", Type: "string", Required: true, Pos: 1}, {Name: "scopes", Type: "string", Doc: "comma-separated: read,write,admin"},
				{Name: "days", Type: "int", Doc: "lifetime in days; 0 = no expiry (not with admin)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if p.Person == nil || p.Person.Kind != "user" {
					return nil, verbs.Errf("permission_denied", "only signed-in people make tokens")
				}
				scopes := a.Strings("scopes")
				if len(scopes) == 0 {
					scopes = []string{sysdb.ScopeRead, sysdb.ScopeWrite}
				}
				if p.Kind == access.KindToken {
					for _, sc := range scopes {
						if !p.HasScope(sc) {
							return nil, verbs.Errf("permission_denied", "a token cannot make a token with more scopes than its own")
						}
					}
				}
				scopes, err := identity.CheckTokenGrant(p.Role(), scopes, int(a.I("days", 30)))
				if err != nil {
					var ge *identity.GrantError
					if errors.As(err, &ge) {
						return nil, verbs.Errf(ge.Code, "%s", ge.Message)
					}
					return nil, err
				}
				secret, t, err := e.People.CreateToken(ctx, p.ID(), a.S("name"), scopes, int(a.I("days", 30)))
				if err != nil {
					return nil, err
				}
				return map[string]any{"token": secret, "info": t}, nil
			}},
		{Name: "token.rm", Doc: "Revoke a token.", Scope: verbs.Write, Action: authz.Account,
			Args: []verbs.Arg{{Name: "id", Type: "string", Required: true, Pos: 1}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				t, err := e.People.Token(ctx, a.S("id"))
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no token %s", a.S("id"))
				}
				if err != nil {
					return nil, err
				}
				if t.Person != p.ID() && !p.IsAdmin() {
					return nil, verbs.Errf("permission_denied", "that token is not yours")
				}
				if err := e.People.RevokeToken(ctx, p.ID(), p.ViaLabel(), t.ID); err != nil {
					return nil, err
				}
				return map[string]any{"revoked": t.ID}, nil
			}},
		{Name: "people.ls", Doc: "List people: users, or guests with --kind guest.", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "kind", Type: "string", Doc: "user or guest (default: user)"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				kind := a.S("kind")
				if kind == "" {
					kind = "user"
				}
				return e.People.People(ctx, kind)
			}},
		{Name: "people.role", Effect: verbs.EffectGovern, Doc: "Set a user's role: pending, member, admin or disabled.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "id", Type: "string", Required: true, Pos: 1}, {Name: "role", Type: "string", Required: true, Pos: 2}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				if a.S("id") == p.ID() && a.S("role") != sysdb.RoleAdmin {
					return nil, verbs.Errf("invalid_argument", "you cannot demote yourself")
				}
				pp, err := e.People.SetRole(ctx, p.ID(), p.ViaLabel(), a.S("id"), a.S("role"))
				if errors.Is(err, sysdb.ErrNotFound) {
					return nil, verbs.Errf("not_found", "no person %s", a.S("id"))
				}
				if err != nil {
					return nil, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				return pp, nil
			}},
		{Name: "log.system", Doc: "The platform log: sign-ups, roles, tokens, grants, mounts, policy.", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Args: []verbs.Arg{{Name: "limit", Type: "int"}},
			Run: func(ctx context.Context, p *access.Principal, a verbs.Args) (any, error) {
				return e.Sys.Logs(ctx, int(a.I("limit", 100)))
			}},
	}
}
