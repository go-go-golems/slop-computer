package verbs

import (
	"context"
	"errors"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/system"
)

func init() {
	Register(
		&Verb{Name: "whoami", Doc: "Who this call acts as: person, role, audience, token and scopes.", Scope: Read,
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
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
		&Verb{Name: "token.ls", Doc: "List your API tokens (admins: --all for everyone's).", Scope: Read,
			Args: []Arg{{Name: "all", Type: "bool", Doc: "every person's tokens (admins)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				who := p.ID()
				if a.B("all") {
					if !p.IsAdmin() {
						return nil, Errf("permission_denied", "only admins list everyone's tokens")
					}
					who = ""
				}
				return e.Sys.Tokens(ctx, who)
			}},
		&Verb{Name: "token.new", Doc: "Make an API token; its secret is shown once.", Scope: Write,
			Args: []Arg{{Name: "name", Type: "string", Required: true, Pos: 1}, {Name: "scopes", Type: "string", Doc: "comma-separated: read,write,admin"},
				{Name: "days", Type: "int", Doc: "lifetime in days; 0 = no expiry (not with admin)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if p.Person == nil || p.Person.Kind != "user" {
					return nil, Errf("permission_denied", "only signed-in people make tokens")
				}
				scopes := a.Strings("scopes")
				if len(scopes) == 0 {
					scopes = []string{system.ScopeRead, system.ScopeWrite}
				}
				if p.Kind == access.KindToken {
					for _, sc := range scopes {
						if !p.HasScope(sc) {
							return nil, Errf("permission_denied", "a token cannot make a token with more scopes than its own")
						}
					}
				}
				scopes, err := system.CheckTokenGrant(p.Role(), scopes, int(a.I("days", 30)))
				if err != nil {
					var ge *system.GrantError
					if errors.As(err, &ge) {
						return nil, Errf(ge.Code, "%s", ge.Message)
					}
					return nil, err
				}
				secret, t, err := e.Sys.CreateToken(ctx, p.ID(), a.S("name"), scopes, int(a.I("days", 30)))
				if err != nil {
					return nil, err
				}
				return map[string]any{"token": secret, "info": t}, nil
			}},
		&Verb{Name: "token.rm", Doc: "Revoke a token.", Scope: Write,
			Args: []Arg{{Name: "id", Type: "string", Required: true, Pos: 1}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				t, err := e.Sys.Token(ctx, a.S("id"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "no token %s", a.S("id"))
				}
				if err != nil {
					return nil, err
				}
				if t.Person != p.ID() && !p.IsAdmin() {
					return nil, Errf("permission_denied", "that token is not yours")
				}
				if err := e.Sys.RevokeToken(ctx, p.ID(), t.ID); err != nil {
					return nil, err
				}
				return map[string]any{"revoked": t.ID}, nil
			}},
		&Verb{Name: "people.ls", Doc: "List people: users, or guests with --kind guest.", Scope: Read, AdminOnly: true,
			Args: []Arg{{Name: "kind", Type: "string", Doc: "user or guest (default: user)"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				kind := a.S("kind")
				if kind == "" {
					kind = "user"
				}
				return e.Sys.People(ctx, kind)
			}},
		&Verb{Name: "people.role", Doc: "Set a user's role: pending, member, admin or disabled.", Scope: Admin, AdminOnly: true,
			Args: []Arg{{Name: "id", Type: "string", Required: true, Pos: 1}, {Name: "role", Type: "string", Required: true, Pos: 2}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				if a.S("id") == p.ID() && a.S("role") != system.RoleAdmin {
					return nil, Errf("invalid_argument", "you cannot demote yourself")
				}
				pp, err := e.Sys.SetRole(ctx, p.ID(), a.S("id"), a.S("role"))
				if errors.Is(err, system.ErrNotFound) {
					return nil, Errf("not_found", "no person %s", a.S("id"))
				}
				if err != nil {
					return nil, Errf("invalid_argument", "%s", err.Error())
				}
				if e.PersonChanged != nil {
					e.PersonChanged(ctx, pp.ID)
				}
				return pp, nil
			}},
		&Verb{Name: "log.system", Doc: "The platform log: sign-ups, roles, tokens, grants, mounts, policy.", Scope: Read, AdminOnly: true,
			Args: []Arg{{Name: "limit", Type: "int"}},
			Run: func(ctx context.Context, e *Env, p *access.Principal, a Args) (any, error) {
				return e.Sys.Logs(ctx, int(a.I("limit", 100)))
			}},
	)
}
