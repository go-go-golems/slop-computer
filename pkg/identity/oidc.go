// Copied from github.com/go-go-golems/francois@106776a pkg/catalog/identity/oidc.go.
// Package identity wraps the OIDC relying party used for sign-in.
// It performs discovery lazily so the portal stays up (and existing sessions
// keep working) while the identity provider is unavailable.
package identity

import (
	"context"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
	"github.com/zitadel/oidc/v3/pkg/client/rp"
	"github.com/zitadel/oidc/v3/pkg/oidc"
	"golang.org/x/oauth2"
)

type Config struct {
	Issuer       string
	ClientID     string
	ClientSecret string
	RedirectURL  string
	// ExtraScopes are appended to openid/profile/email, for example
	// urn:zitadel:iam:org:id:<id> to select the ZITADEL organization whose
	// login policy applies and to which users belong.
	ExtraScopes []string
}

// ValidateScopes rejects empty scopes and scopes containing whitespace, which
// would split into several scopes in the space-separated scope parameter.
func ValidateScopes(scopes []string) error {
	for _, sc := range scopes {
		if sc == "" || strings.ContainsAny(sc, " \t\r\n") {
			return errors.Errorf("invalid OIDC scope %q", sc)
		}
	}
	return nil
}

type Provider struct {
	cfg Config
	mu  sync.Mutex
	rp  rp.RelyingParty
}

type nonceKey struct{}

func New(cfg Config) *Provider { return &Provider{cfg: cfg} }

func (p *Provider) Configured() bool { return p.cfg.Issuer != "" && p.cfg.ClientID != "" }

func (p *Provider) Issuer() string { return p.cfg.Issuer }

func (p *Provider) party(ctx context.Context) (rp.RelyingParty, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.rp != nil {
		return p.rp, nil
	}
	if !p.Configured() {
		return nil, errors.New("OIDC is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	party, err := rp.NewRelyingPartyOIDC(ctx, p.cfg.Issuer, p.cfg.ClientID, p.cfg.ClientSecret, p.cfg.RedirectURL,
		p.scopes(),
		rp.WithVerifierOpts(rp.WithNonce(func(ctx context.Context) string {
			n, _ := ctx.Value(nonceKey{}).(string)
			return n
		}), rp.WithIssuedAtOffset(5*time.Second)),
		rp.WithSigningAlgsFromDiscovery(),
	)
	if err != nil {
		return nil, errors.Wrap(err, "discover OIDC issuer")
	}
	p.rp = party
	return party, nil
}

func (p *Provider) scopes() []string {
	return append([]string{oidc.ScopeOpenID, oidc.ScopeProfile, oidc.ScopeEmail}, p.cfg.ExtraScopes...)
}

// AuthURL builds the authorization redirect with S256 PKCE and a nonce.
func (p *Provider) AuthURL(ctx context.Context, state, nonce, verifier string, prompt, idpID string) (string, error) {
	party, err := p.party(ctx)
	if err != nil {
		return "", err
	}
	opts := []rp.AuthURLOpt{rp.WithCodeChallenge(oidc.NewSHACodeChallenge(verifier)), withParam("nonce", nonce)}
	if idpID != "" {
		opts = append(opts, withParam("scope", strings.Join(p.scopes(), " ")+" urn:zitadel:iam:org:idp:id:"+idpID))
	}
	if prompt != "" {
		opts = append(opts, rp.WithPrompt(prompt))
	}
	u := rp.AuthURL(state, party, opts...)
	return u, nil
}

// Exchange redeems the code with the PKCE verifier and validates the ID token
// (issuer, audience, signature, expiry and nonce) through the library. It
// also returns the raw ID token, kept only as the logout id_token_hint.
func (p *Provider) Exchange(ctx context.Context, code, verifier, nonce string) (store.Identity, string, error) {
	party, err := p.party(ctx)
	if err != nil {
		return store.Identity{}, "", err
	}
	ctx = context.WithValue(ctx, nonceKey{}, nonce)
	tokens, err := rp.CodeExchange[*oidc.IDTokenClaims](ctx, code, party, rp.WithCodeVerifier(verifier))
	if err != nil {
		return store.Identity{}, "", errors.Wrap(err, "exchange authorization code")
	}
	c := tokens.IDTokenClaims
	id := store.Identity{Issuer: c.Issuer, Subject: c.Subject, Email: c.Email, EmailVerified: bool(c.EmailVerified), Name: c.Name}
	if id.Name == "" || id.Email == "" {
		// ZITADEL may omit profile claims from the ID token; ask userinfo.
		info, uerr := rp.Userinfo[*oidc.UserInfo](ctx, tokens.AccessToken, tokens.TokenType, c.Subject, party)
		if uerr == nil {
			if id.Email == "" {
				id.Email, id.EmailVerified = info.Email, bool(info.EmailVerified)
			}
			if id.Name == "" {
				id.Name = info.Name
			}
		}
	}
	if id.Subject == "" || id.Issuer != p.cfg.Issuer {
		return store.Identity{}, "", errors.New("identity token has an unexpected issuer or subject")
	}
	return id, tokens.IDToken, nil
}

// LogoutURL builds the OpenID Connect RP-Initiated Logout redirect that ends
// the identity provider's browser session and returns to postLogout, which
// must be registered on the client. It is empty when the issuer advertises
// no end_session_endpoint.
func (p *Provider) LogoutURL(ctx context.Context, idToken, postLogout, state string) (string, error) {
	party, err := p.party(ctx)
	if err != nil {
		return "", err
	}
	endpoint := party.GetEndSessionEndpoint()
	if endpoint == "" {
		return "", nil
	}
	u, err := url.Parse(endpoint)
	if err != nil {
		return "", errors.Wrap(err, "parse end_session_endpoint")
	}
	q := u.Query()
	q.Set("client_id", p.cfg.ClientID)
	q.Set("post_logout_redirect_uri", postLogout)
	if idToken != "" {
		q.Set("id_token_hint", idToken)
	}
	if state != "" {
		q.Set("state", state)
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}

func withParam(key, value string) rp.AuthURLOpt {
	return func() []oauth2.AuthCodeOption { return []oauth2.AuthCodeOption{oauth2.SetAuthURLParam(key, value)} }
}
