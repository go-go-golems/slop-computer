// Package config is slop.yaml plus flags.
package config

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// Hosts are the domains the server answers, with their kind.
type Hosts struct {
	Main    string   `yaml:"main"`    // back office, sign-in, /api/v1
	Live    []string `yaml:"live"`    // apps for visitors: shell, sessions, guests
	Static  []string `yaml:"static"`  // files only, no sessions
	Sandbox string   `yaml:"sandbox"` // s<label>.<sandbox>, one origin per store+app
}

// OIDC is the sign-in provider (Zitadel in production).
type OIDC struct {
	Issuer           string `yaml:"issuer"`
	ClientIDFile     string `yaml:"client_id_file"`
	ClientSecretFile string `yaml:"client_secret_file"`
	Scope            string `yaml:"scope"`
}

// Stripe enables subscriptions through Stripe Checkout.
type Stripe struct {
	SecretKeyFile     string   `yaml:"secret_key_file"`
	WebhookSecretFile string   `yaml:"webhook_secret_file"`
	Prices            []string `yaml:"prices"`
	Trials            bool     `yaml:"trials"`
}

// Config is the whole server configuration.
type Config struct {
	Listen      string   `yaml:"listen"`
	Data        string   `yaml:"data"`
	Scheme      string   `yaml:"scheme"` // http or https: how browsers reach the hosts
	Hosts       Hosts    `yaml:"hosts"`
	AdminEmails []string `yaml:"admin_emails"`
	Signup      string   `yaml:"signup"` // open (default) or approval
	// GuestsPerHour caps the new guests one address may create in an hour
	// (0: system.GuestsPerHour, 30).
	GuestsPerHour int    `yaml:"guests_per_hour"`
	Local         bool   `yaml:"local"` // local sign-in form instead of OIDC (development)
	Test          bool   `yaml:"test"`  // loopback only: X-Slop-As, fake LLM, virtual clock
	TrustProxy    bool   `yaml:"trust_proxy_headers"`
	OIDC          OIDC   `yaml:"oidc"`
	Stripe        Stripe `yaml:"stripe"`
	SecretKey     string `yaml:"secret_key_file"` // HMAC key for sandbox labels and secrets
	LLM           string `yaml:"llm"`             // "" (off), "pi" (Pi's models through Geppetto) or "fake"
	Pi            Pi     `yaml:"pi"`
}

// Pi configures the sample capability's models: Pi's agent directory, read
// by Geppetto's Pi provider (pkg/llm/gepp).
type Pi struct {
	AgentDir string            `yaml:"agent_dir"` // ~/.pi/agent (models, credentials, settings)
	Models   map[string]string `yaml:"models"`    // tier (quick, default, complex) -> provider/model
}

// Load reads a YAML file (optional) and applies defaults.
func Load(path string) (*Config, error) {
	c := &Config{}
	if path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return nil, err
		}
		if err := yaml.Unmarshal(b, c); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
	}
	c.Defaults()
	return c, nil
}

// Defaults fills in what is missing, for a local development setup on
// *.localhost, which browsers and curl resolve to the loopback address.
func (c *Config) Defaults() {
	if c.Listen == "" {
		c.Listen = "127.0.0.1:18300"
	}
	if c.Data == "" {
		c.Data = "data"
	}
	port := ""
	if i := strings.LastIndex(c.Listen, ":"); i >= 0 {
		port = c.Listen[i:]
	}
	if c.Hosts.Main == "" {
		c.Hosts.Main = "slop.localhost" + port
	}
	if len(c.Hosts.Live) == 0 {
		c.Hosts.Live = []string{"apps.localhost" + port}
	}
	if len(c.Hosts.Static) == 0 {
		c.Hosts.Static = []string{"site.localhost" + port}
	}
	if c.Hosts.Sandbox == "" {
		c.Hosts.Sandbox = "sbx.localhost" + port
	}
	if c.Scheme == "" {
		c.Scheme = "http"
	}
	if c.Signup == "" {
		c.Signup = "open"
	}
}

// SignupOpen reports whether new users become members.
func (c *Config) SignupOpen() bool { return c.Signup != "approval" }

// MainURL is the main host's origin.
func (c *Config) MainURL() string { return c.Scheme + "://" + c.Hosts.Main }

// Origin is the origin of any host.
func (c *Config) Origin(host string) string { return c.Scheme + "://" + host }

// HostKind classifies a Host header: main, live, static, sandbox or "".
func (c *Config) HostKind(host string) string {
	h := strings.ToLower(host)
	switch {
	case h == strings.ToLower(c.Hosts.Main):
		return "main"
	case contains(c.Hosts.Live, h):
		return "live"
	case contains(c.Hosts.Static, h):
		return "static"
	case c.Hosts.Sandbox != "" && strings.HasSuffix(h, "."+strings.ToLower(c.Hosts.Sandbox)):
		return "sandbox"
	}
	return ""
}

// SecureCookies reports whether cookies get Secure and the __Host- prefix.
func (c *Config) SecureCookies() bool { return c.Scheme == "https" }

func contains(list []string, h string) bool {
	for _, x := range list {
		if strings.EqualFold(x, h) {
			return true
		}
	}
	return false
}

// Key returns the server's HMAC key: the secret key file's bytes, or a key
// generated once into <data>/secret.key.
func (c *Config) Key() ([]byte, error) {
	path := c.SecretKey
	if path == "" {
		path = filepath.Join(c.Data, "secret.key")
	}
	if b, err := os.ReadFile(path); err == nil && len(bytes.TrimSpace(b)) >= 16 {
		return bytes.TrimSpace(b), nil
	} else if c.SecretKey != "" {
		return nil, fmt.Errorf("secret key file %s: missing or shorter than 16 bytes", path)
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	key := []byte(hex.EncodeToString(b))
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	return key, os.WriteFile(path, key, 0o600)
}
