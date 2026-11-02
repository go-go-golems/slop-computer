// Package client is the CLI's side of the HTTP door, and the stored logins.
package client

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Login is one stored server login. The file keeps slop-computer v2's
// format, so v2's CLI (installed as slop2 during the cut-over) and this one
// share ~/.config/slop/credentials.json, keyed by server URL.
type Login struct {
	Token     string         `json:"token"`
	TokenID   string         `json:"tokenId"`
	Name      string         `json:"name"`
	User      map[string]any `json:"user,omitempty"`
	Scopes    []string       `json:"scopes"`
	ExpiresAt any            `json:"expiresAt,omitempty"`
	SavedAt   string         `json:"savedAt"`
}

// Credentials is the whole file.
type Credentials struct {
	Version int              `json:"version"`
	Default string           `json:"default"`
	Servers map[string]Login `json:"servers"`
}

// CredentialsPath is ~/.config/slop/credentials.json (or $SLOP_CREDENTIALS).
func CredentialsPath() string {
	if p := os.Getenv("SLOP_CREDENTIALS"); p != "" {
		return p
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = filepath.Join(os.Getenv("HOME"), ".config")
	}
	return filepath.Join(dir, "slop", "credentials.json")
}

// LoadCredentials reads the file (empty when missing).
func LoadCredentials() (*Credentials, error) {
	c := &Credentials{Version: 1, Servers: map[string]Login{}}
	b, err := os.ReadFile(CredentialsPath())
	if errors.Is(err, os.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(b, c); err != nil {
		return nil, fmt.Errorf("%s: %w", CredentialsPath(), err)
	}
	if c.Servers == nil {
		c.Servers = map[string]Login{}
	}
	return c, nil
}

// Save writes the file with mode 0600, keeping other servers' logins.
func (c *Credentials) Save() error {
	p := CredentialsPath()
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, p)
}

// Client calls one server.
type Client struct {
	Server string // origin, e.g. http://slop.localhost:18300
	Token  string
	HTTP   *http.Client
}

// Resolve picks the server (flag, $SLOP_SERVER, the default login) and its token.
func Resolve(server string) (*Client, error) {
	if server == "" {
		server = os.Getenv("SLOP_SERVER")
	}
	creds, err := LoadCredentials()
	if err != nil {
		return nil, err
	}
	if server == "" {
		server = creds.Default
	}
	if server == "" {
		return nil, errors.New("no server: run `slop auth login --server <url>` or set SLOP_SERVER")
	}
	server = strings.TrimRight(server, "/")
	tok := os.Getenv("SLOP_TOKEN")
	if tok == "" {
		tok = creds.Servers[server].Token
	}
	return &Client{Server: server, Token: tok, HTTP: &http.Client{Timeout: 10 * time.Minute}}, nil
}

// APIError is an error answer from the server.
type APIError struct {
	Status  int
	Code    string   `json:"code"`
	Message string   `json:"message"`
	Trace   []string `json:"trace,omitempty"`
	Extra   any      `json:"extra,omitempty"`
}

func (e *APIError) Error() string {
	s := e.Code + ": " + e.Message
	for _, t := range e.Trace {
		s += "\n  " + t
	}
	return s
}

// Post sends JSON to a path and decodes the JSON answer into out.
func (c *Client) Post(path string, in, out any) error {
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return err
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest("POST", c.Server+path, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Slop-Via", "cli")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode >= 400 {
		var w struct {
			Error *APIError `json:"error"`
		}
		if json.Unmarshal(raw, &w) == nil && w.Error != nil {
			w.Error.Status = resp.StatusCode
			return w.Error
		}
		return &APIError{Status: resp.StatusCode, Code: "http_" + fmt.Sprint(resp.StatusCode), Message: strings.TrimSpace(string(raw))}
	}
	if out == nil {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return dec.Decode(out)
}

// Call runs a verb and returns its result.
func (c *Client) Call(verb string, args map[string]any) (any, error) {
	var out struct {
		Result any `json:"result"`
	}
	if err := c.Post("/api/v1/"+verb, args, &out); err != nil {
		return nil, err
	}
	return out.Result, nil
}
