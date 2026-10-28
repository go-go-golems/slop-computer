package client

import (
	"context"
	"net/http"
	"time"
)

// Me is GET /api/me: who the client acts as.
type Me struct {
	User      MeUser `json:"user"`
	Token     *Token `json:"token"`
	CSRFToken string `json:"csrfToken,omitempty"`
}

type MeUser struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
	Local bool   `json:"local"`
}

// Token is a personal API token's metadata (never its secret).
type Token struct {
	ID         string     `json:"id"`
	Owner      string     `json:"owner"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	CreatedAt  time.Time  `json:"createdAt"`
	LastUsedAt *time.Time `json:"lastUsedAt,omitempty"`
	ExpiresAt  *time.Time `json:"expiresAt,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
}

// Config is GET /api/config.
type Config struct {
	Mode          string   `json:"mode"`
	PublicURL     string   `json:"publicUrl"`
	SiteHosts     []string `json:"siteHosts"`
	SandboxDomain string   `json:"sandboxDomain"`
}

func (c *Client) Me(ctx context.Context) (Me, error) {
	var out Me
	return out, c.get(ctx, "/api/me", nil, &out)
}

func (c *Client) Config(ctx context.Context) (Config, error) {
	var out Config
	return out, c.get(ctx, "/api/config", nil, &out)
}

// DeviceCode is the server's answer to a device login request.
type DeviceCode struct {
	DeviceCode              string `json:"deviceCode"`
	UserCode                string `json:"userCode"`
	VerificationURI         string `json:"verificationUri"`
	VerificationURIComplete string `json:"verificationUriComplete"`
	ExpiresIn               int    `json:"expiresIn"`
	Interval                int    `json:"interval"`
}

// DeviceToken is the token issued once a login was approved (device or local);
// Token is its secret, shown only here.
type DeviceToken struct {
	Token string `json:"token"`
	Info  Token  `json:"info"`
	User  MeUser `json:"user"`
}

// DeviceAuthorize starts a device login (POST /api/device/authorize).
func (c *Client) DeviceAuthorize(ctx context.Context, clientName string, scopes []string, days *int) (DeviceCode, error) {
	var out DeviceCode
	in := map[string]any{"clientName": clientName, "scopes": scopes}
	if days != nil {
		in["days"] = *days
	}
	return out, c.send2(ctx, http.MethodPost, "/api/device/authorize", in, &out)
}

// DevicePoll asks once whether the login was approved (POST /api/device/token).
func (c *Client) DevicePoll(ctx context.Context, deviceCode string) (DeviceToken, error) {
	var out DeviceToken
	return out, c.send2(ctx, http.MethodPost, "/api/device/token", map[string]string{"deviceCode": deviceCode}, &out)
}

// LocalToken mints a token for a nickname on a local-mode server.
func (c *Client) LocalToken(ctx context.Context, nickname, name string, scopes []string, days int) (DeviceToken, error) {
	var out DeviceToken
	return out, c.send2(ctx, http.MethodPost, "/api/local/token", map[string]any{"nickname": nickname, "name": name, "scopes": scopes, "days": days}, &out)
}

// RevokeSelf revokes the client's own token (DELETE /api/me/token).
func (c *Client) RevokeSelf(ctx context.Context) error {
	return c.send2(ctx, http.MethodDelete, "/api/me/token", nil, nil)
}
