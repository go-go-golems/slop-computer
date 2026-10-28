package identity

import (
	"net"
	"net/url"
	"regexp"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// LocalIssuer is the issuer of nickname identities in local mode. Local users
// are ordinary users rows, so everything after sign-in is production code.
const LocalIssuer = "local"

var nickname = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

// LocalIdentity turns a nickname into an identity, or explains why not.
func LocalIdentity(nick string) (store.Identity, error) {
	nick = strings.ToLower(strings.TrimSpace(nick))
	if !nickname.MatchString(nick) {
		return store.Identity{}, errors.New("a nickname is 1–32 lowercase letters, digits, - or _, starting with a letter or digit")
	}
	return store.Identity{Issuer: LocalIssuer, Subject: nick, Name: nick, Email: nick + "@local", EmailVerified: true}, nil
}

// IsLoopbackHost reports whether host (with or without a port) names the
// loopback interface: localhost, *.localhost, 127.0.0.0/8 or ::1.
func IsLoopbackHost(host string) bool {
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	host = strings.Trim(strings.ToLower(host), "[]")
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// CheckLocalSafe refuses local mode unless the server listens only on the
// loopback interface and its public URL is a loopback http URL. There is no
// override: a shared deployment uses OIDC.
func CheckLocalSafe(listen string, public *url.URL) error {
	host, _, err := net.SplitHostPort(listen)
	if err != nil {
		return errors.Wrap(err, "listen address")
	}
	if host == "" || !IsLoopbackHost(host) {
		return errors.Errorf("local mode (no authentication) only listens on a loopback address, not %q", listen)
	}
	if public == nil || public.Scheme != "http" || !IsLoopbackHost(public.Host) {
		return errors.Errorf("local mode needs an http://localhost or http://127.0.0.1 public URL, not %q", public)
	}
	return nil
}
