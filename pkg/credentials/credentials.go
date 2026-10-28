// Copied from github.com/go-go-golems/slop@106776a pkg/catalog/credentials/credentials.go.
// Package credentials stores the personal API tokens the CLI logs in with,
// one per portal origin, in a JSON file only the owner can read, and resolves
// which server and token a command uses: flags first, then SLOP_SERVER and
// SLOP_TOKEN, then the file. It does no network calls.
package credentials

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/pkg/errors"
)

// Version is the file format this package writes.
const Version = 1

// User is the token owner as the server reported it at login.
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
	Role  string `json:"role"`
}

// Entry is the login for one portal origin. Everything but Token and Host is
// a cache for status output; the server stays the authority.
type Entry struct {
	Token     string     `json:"token"`
	TokenID   string     `json:"tokenId,omitempty"`
	Name      string     `json:"name,omitempty"`
	User      User       `json:"user"`
	Scopes    []string   `json:"scopes,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	SavedAt   time.Time  `json:"savedAt"`
	// Host overrides the Host header (tunnels), as --host did at login.
	Host string `json:"host,omitempty"`
}

// File is the credentials file.
type File struct {
	Version int              `json:"version"`
	Default string           `json:"default,omitempty"`
	Servers map[string]Entry `json:"servers"`
}

// Dir is $SLOP_CONFIG_DIR, else $XDG_CONFIG_HOME/slop, else
// ~/.config/slop on every platform.
func Dir() (string, error) {
	if d := os.Getenv("SLOP_CONFIG_DIR"); d != "" {
		return d, nil
	}
	if d := os.Getenv("XDG_CONFIG_HOME"); d != "" {
		return filepath.Join(d, "slop"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", errors.Wrap(err, "find the home directory")
	}
	return filepath.Join(home, ".config", "slop"), nil
}

// Path is the credentials file inside Dir.
func Path() (string, error) {
	d, err := Dir()
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "credentials.json"), nil
}

// Load reads the file; a missing file is an empty one. warning is non-empty
// when other users may read the file.
func Load() (File, string, error) {
	p, err := Path()
	if err != nil {
		return File{}, "", err
	}
	f := File{Version: Version, Servers: map[string]Entry{}}
	raw, err := os.ReadFile(p) // #nosec G304 -- the user's own config file
	if errors.Is(err, fs.ErrNotExist) {
		return f, "", nil
	}
	if err != nil {
		return File{}, "", errors.Wrap(err, "read credentials")
	}
	if err = json.Unmarshal(raw, &f); err != nil {
		return File{}, "", errors.Wrapf(err, "parse %s", p)
	}
	if f.Version > Version {
		return File{}, "", errors.Errorf("%s has format version %d; this slop understands %d", p, f.Version, Version)
	}
	if f.Servers == nil {
		f.Servers = map[string]Entry{}
	}
	warning := ""
	if st, err := os.Stat(p); err == nil && st.Mode().Perm()&0o077 != 0 {
		warning = fmt.Sprintf("%s is readable by other users; run chmod 600 %s", p, p)
	}
	return f, warning, nil
}

// Save writes the file atomically: directory 0700, file 0600.
func Save(f File) error {
	p, err := Path()
	if err != nil {
		return err
	}
	dir := filepath.Dir(p)
	if err = os.MkdirAll(dir, 0o700); err != nil {
		return errors.Wrap(err, "create the config directory")
	}
	f.Version = Version
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".credentials-*.json") // created 0600
	if err != nil {
		return errors.Wrap(err, "write credentials")
	}
	defer func() { _ = os.Remove(tmp.Name()) }() // no-op after the rename
	if _, err = tmp.Write(append(raw, '\n')); err == nil {
		err = tmp.Sync()
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Chmod(tmp.Name(), 0o600)
	}
	if err == nil {
		err = os.Rename(tmp.Name(), p)
	}
	return errors.Wrap(err, "write credentials")
}

// Put stores the login for origin; it becomes the default when asked or when
// there is none.
func (f *File) Put(origin string, e Entry, makeDefault bool) {
	if f.Servers == nil {
		f.Servers = map[string]Entry{}
	}
	f.Servers[origin] = e
	if makeDefault || f.Default == "" {
		f.Default = origin
	}
}

// Remove forgets origin and reports whether it was stored. The default moves
// to another stored server, if any.
func (f *File) Remove(origin string) bool {
	if _, ok := f.Servers[origin]; !ok {
		return false
	}
	delete(f.Servers, origin)
	if f.Default == origin {
		f.Default = ""
		for o := range f.Servers {
			if f.Default == "" || o < f.Default {
				f.Default = o
			}
		}
	}
	return true
}

// NormalizeOrigin turns user input into the key used in the file and the base
// URL of the client: lower-case scheme and host, no default port, no path.
// A bare host means https.
func NormalizeOrigin(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw != "" && !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", errors.Errorf("%q is not a portal origin such as https://catalog.example.com", raw)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", errors.Errorf("%q: the portal origin must use https or http", raw)
	}
	if u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.Errorf("%q: give only the portal origin, such as https://catalog.example.com", raw)
	}
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (scheme == "https" && port == "443") || (scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	return scheme + "://" + host, nil
}

// Source says where a resolved value came from.
type Source string

const (
	FromFlag      Source = "flag"
	FromEnv       Source = "env"
	FromFile      Source = "file"
	FromTokenFile Source = "token-file"
)

// Inputs are the raw connection flags of a command.
type Inputs struct{ Server, TokenFile, Host string }

// Resolved is the server and token a command uses.
type Resolved struct {
	Server, Token, Host       string
	ServerSource, TokenSource Source
	// Entry is the stored login for Server, when the file was consulted and
	// has one.
	Entry    *Entry
	Warnings []string
}

// ResolveServer picks the server without requiring a token: --server, then
// SLOP_SERVER, then the file's default.
func ResolveServer(flag string) (Resolved, error) {
	var r Resolved
	server, src := flag, FromFlag
	if server == "" {
		server, src = os.Getenv("SLOP_SERVER"), FromEnv
	}
	if server == "" {
		f, warning, err := Load()
		if err != nil {
			return r, err
		}
		r.addWarning(warning)
		server, src = f.Default, FromFile
	}
	if server == "" {
		return r, errors.New("set --server or SLOP_SERVER to the portal origin, e.g. https://catalog.example.com, or log in with slop auth login --server URL")
	}
	origin, err := NormalizeOrigin(server)
	if err != nil {
		return r, err
	}
	r.Server, r.ServerSource = origin, src
	return r, nil
}

// Resolve picks the server (see ResolveServer) and the token: --token-file,
// then SLOP_TOKEN, then the file's login for that server. The host is
// --host, else the stored login's. The file is read only when a flag or the
// environment leaves something open.
func Resolve(in Inputs) (Resolved, error) {
	r, err := ResolveServer(in.Server)
	if err != nil {
		return r, err
	}
	r.Host = in.Host
	switch {
	case in.TokenFile != "":
		raw, err := os.ReadFile(in.TokenFile) // #nosec G304 -- the operator names the token file
		if err != nil {
			return r, errors.Wrap(err, "read token file")
		}
		r.Token, r.TokenSource = strings.TrimSpace(string(raw)), FromTokenFile
	case os.Getenv("SLOP_TOKEN") != "":
		r.Token, r.TokenSource = os.Getenv("SLOP_TOKEN"), FromEnv
	default:
		f, warning, err := Load()
		if err != nil {
			return r, err
		}
		r.addWarning(warning)
		if e, ok := f.Servers[r.Server]; ok {
			r.Token, r.TokenSource, r.Entry = e.Token, FromFile, &e
			if r.Host == "" {
				r.Host = e.Host
			}
		}
	}
	if r.Token == "" {
		return r, errors.Errorf("not logged in to %s: run slop auth login --server %s, or set SLOP_TOKEN", r.Server, r.Server)
	}
	return r, nil
}

func (r *Resolved) addWarning(w string) {
	if w != "" && !slices.Contains(r.Warnings, w) {
		r.Warnings = append(r.Warnings, w)
	}
}
