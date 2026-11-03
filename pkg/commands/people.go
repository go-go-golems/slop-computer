package commands

import (
	"errors"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/authz"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

func peopleVerbs(e peopleEnv) []*verbs.Verb {
	return []*verbs.Verb{
		verbs.Def[WhoamiIn, WhoamiOut]{Name: "whoami", Doc: "Who this call acts as: person, role, audience, token and scopes.", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in WhoamiIn) (WhoamiOut, error) {
				p := req.Principal
				out := WhoamiOut{Kind: p.Kind, ID: p.ID(), Via: p.ViaLabel()}
				if p.Person != nil {
					out.Person = p.Person
				}
				if p.TokenID != "" {
					out.Token = ptr[string](p.TokenID)
					out.Scopes = ptr[[]string](p.Scopes)
				}
				return out, nil
			}}.Verb(),
		verbs.Def[TokenLsIn, []identity.Token]{Name: "token.ls", Doc: "List your API tokens (admins: --all for everyone's).", Scope: verbs.Read, Action: authz.Account,
			Run: func(req verbs.Req, in TokenLsIn) ([]identity.Token, error) {
				ctx := req.Context
				p := req.Principal
				who := p.ID()
				if in.All {
					if !p.IsAdmin() {
						return nil, verbs.Errf("permission_denied", "only admins list everyone's tokens")
					}
					who = ""
				}
				return e.People.Tokens(ctx, who)
			}}.Verb(),
		verbs.Def[TokenNewIn, TokenNewOut]{Name: "token.new", Doc: "Make an API token; its secret is shown once.", Scope: verbs.Write, Action: authz.Account,
			Run: func(req verbs.Req, in TokenNewIn) (TokenNewOut, error) {
				ctx := req.Context
				p := req.Principal
				if p.Person == nil || p.Person.Kind != "user" {
					return TokenNewOut{}, verbs.Errf("permission_denied", "only signed-in people make tokens")
				}
				scopes := []string(in.Scopes)
				if len(scopes) == 0 {
					scopes = []string{sysdb.ScopeRead, sysdb.ScopeWrite}
				}
				if p.Kind == access.KindToken {
					for _, sc := range scopes {
						if !p.HasScope(sc) {
							return TokenNewOut{}, verbs.Errf("permission_denied", "a token cannot make a token with more scopes than its own")
						}
					}
				}
				scopes, err := identity.CheckTokenGrant(p.Role(), scopes, int(or(in.Days, 30)))
				if err != nil {
					var ge *identity.GrantError
					if errors.As(err, &ge) {
						return TokenNewOut{}, verbs.Errf(ge.Code, "%s", ge.Message)
					}
					return TokenNewOut{}, err
				}
				secret, t, err := e.People.CreateToken(ctx, p.ID(), in.Name, scopes, int(or(in.Days, 30)))
				if err != nil {
					return TokenNewOut{}, err
				}
				return TokenNewOut{Token: secret, Info: t}, nil
			}}.Verb(),
		verbs.Def[TokenRmIn, TokenRmOut]{Name: "token.rm", Doc: "Revoke a token.", Scope: verbs.Write, Action: authz.Account,
			Run: func(req verbs.Req, in TokenRmIn) (TokenRmOut, error) {
				ctx := req.Context
				p := req.Principal
				t, err := e.People.Token(ctx, in.ID)
				if errors.Is(err, sysdb.ErrNotFound) {
					return TokenRmOut{}, verbs.Errf("not_found", "no token %s", in.ID)
				}
				if err != nil {
					return TokenRmOut{}, err
				}
				if t.Person != p.ID() && !p.IsAdmin() {
					return TokenRmOut{}, verbs.Errf("permission_denied", "that token is not yours")
				}
				if err := e.People.RevokeToken(ctx, p.ID(), p.ViaLabel(), t.ID); err != nil {
					return TokenRmOut{}, err
				}
				return TokenRmOut{Revoked: t.ID}, nil
			}}.Verb(),
		verbs.Def[PeopleLsIn, []sysdb.Person]{Name: "people.ls", Doc: "List people: users, or guests with --kind guest.", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in PeopleLsIn) ([]sysdb.Person, error) {
				ctx := req.Context
				kind := in.Kind
				if kind == "" {
					kind = "user"
				}
				return e.People.People(ctx, kind)
			}}.Verb(),
		verbs.Def[PeopleRoleIn, sysdb.Person]{Name: "people.role", Effect: verbs.EffectGovern, Doc: "Set a user's role: pending, member, admin or disabled.", Scope: verbs.Write, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in PeopleRoleIn) (sysdb.Person, error) {
				ctx := req.Context
				p := req.Principal
				if in.ID == p.ID() && in.Role != sysdb.RoleAdmin {
					return sysdb.Person{}, verbs.Errf("invalid_argument", "you cannot demote yourself")
				}
				pp, err := e.People.SetRole(ctx, p.ID(), p.ViaLabel(), in.ID, in.Role)
				if errors.Is(err, sysdb.ErrNotFound) {
					return sysdb.Person{}, verbs.Errf("not_found", "no person %s", in.ID)
				}
				if err != nil {
					return sysdb.Person{}, verbs.Errf("invalid_argument", "%s", err.Error())
				}
				return pp, nil
			}}.Verb(),
		verbs.Def[LogSystemIn, []sysdb.LogEntry]{Name: "log.system", Doc: "The platform log: sign-ups, roles, tokens, grants, mounts, policy.", Scope: verbs.Read, AdminOnly: true, Action: authz.PlatformAdmin,
			Run: func(req verbs.Req, in LogSystemIn) ([]sysdb.LogEntry, error) {
				ctx := req.Context
				return e.Sys.Logs(ctx, int(or(in.Limit, 100)))
			}}.Verb(),
	}
}

// WhoamiIn is whoami's input.
type WhoamiIn struct {
}

// TokenLsIn is token.ls's input.
type TokenLsIn struct {
	All bool `json:"all,omitempty" jsonschema_description:"every person's tokens (admins)"`
}

// TokenNewIn is token.new's input.
type TokenNewIn struct {
	Name   string     `json:"name" slop:"pos=1"`
	Scopes verbs.List `json:"scopes,omitempty" jsonschema_description:"comma-separated: read,write,admin"`
	Days   *int64     `json:"days,omitempty" jsonschema_description:"lifetime in days; 0 = no expiry (not with admin)"`
}

// TokenRmIn is token.rm's input.
type TokenRmIn struct {
	ID string `json:"id" slop:"pos=1"`
}

// PeopleLsIn is people.ls's input.
type PeopleLsIn struct {
	Kind string `json:"kind,omitempty" jsonschema_description:"user or guest (default: user)"`
}

// PeopleRoleIn is people.role's input.
type PeopleRoleIn struct {
	ID   string `json:"id" slop:"pos=1"`
	Role string `json:"role" slop:"pos=2"`
}

// LogSystemIn is log.system's input.
type LogSystemIn struct {
	Limit *int64 `json:"limit,omitempty"`
}

// WhoamiOut is whoami's result.
type WhoamiOut struct {
	ID     string        `json:"id"`
	Kind   string        `json:"kind"`
	Person *sysdb.Person `json:"person,omitempty"` // set only when there is one
	Scopes *[]string     `json:"scopes,omitempty"` // present (even empty) for a token
	Token  *string       `json:"token,omitempty"`
	Via    string        `json:"via"`
}

// TokenNewOut is token.new's result.
type TokenNewOut struct {
	Info  identity.Token `json:"info"`
	Token string         `json:"token"`
}

// TokenRmOut is token.rm's result.
type TokenRmOut struct {
	Revoked string `json:"revoked"`
}
