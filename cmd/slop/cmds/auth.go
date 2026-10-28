// Ported from github.com/go-go-golems/francois@106776a cmd/francois/cmds/auth.go.
package cmds

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/go-go-golems/glazed/pkg/cli"
	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/credentials"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
	"golang.org/x/term"
)

// The auth commands log in to a slop server and keep the personal API token
// in the credentials file (see credentials.Path), which every other command
// then uses.

func authCommands() (*cobra.Command, error) {
	g := &cobra.Command{Use: "auth", Short: "Log in to a slop server and manage the stored API token"}
	for _, c := range []glazed.Command{
		&authLogin{glazed.NewCommandDescription("login",
			glazed.WithShort("Log in and store a personal API token for a server"),
			glazed.WithLong("Prints a code and a link: open it in a browser where you are signed in, check the code, choose scopes and approve. "+
				"The new token (by default with every scope your role allows, for 90 days) is saved per server in the credentials file "+
				"($SLOP_CONFIG_DIR, $XDG_CONFIG_HOME/slop or ~/.config/slop, mode 0600). "+
				"With --with-token, reads an existing token from stdin (or a hidden prompt) instead. "+
				"Against a server in local mode, --as <nickname> gets a token for that nickname without a browser. "+
				"SLOP_TOKEN and --token-file still take precedence over stored logins."),
			glazed.WithFlags(
				flag("server", "Server origin, e.g. https://slop.computer or http://localhost:8080 (default: $SLOP_SERVER, then the default stored login)"),
				flag("as", "Local mode only: the nickname to get a token for, without a browser"),
				flag("host", "Host header override, for tunnels; stored with the login"),
				list("scopes", "Scopes to pre-select for approval (default: every scope your role allows)"),
				flag("days", "Token lifetime to pre-select, 0 = no expiry (default 90; admin scopes need 1-90)"),
				flag("name", "Token name shown in the Admin screen (default: slop CLI on <hostname>, or the nickname with --as)"),
				boolean("no-browser", "Only print the link; do not open a browser"),
				boolean("with-token", "Read an existing token from stdin instead of approving a new one in the browser"),
				boolean("no-default", "Do not make this server the default"),
			))},
		&authStatus{glazed.NewCommandDescription("status",
			glazed.WithShort("Show stored logins and which token commands use"),
			glazed.WithFlags(
				flag("server", "Only this server"),
				boolean("check", "Ask each server whether its token is still valid"),
			))},
		&authToken{glazed.NewCommandDescription("token",
			glazed.WithShort("Print the token commands would use, e.g. export SLOP_TOKEN=$(slop auth token)"),
			glazed.WithFlags(
				flag("server", "Server origin (default: $SLOP_SERVER, then the default stored login)"),
				boolean("yes", "Print even when stdout is a terminal"),
			))},
		&authLogout{glazed.NewCommandDescription("logout",
			glazed.WithShort("Revoke and forget the stored token for a server"),
			glazed.WithFlags(
				flag("server", "Server origin (default: $SLOP_SERVER, then the default stored login)"),
				boolean("all", "Log out of every stored server"),
				boolean("keep-token", "Only forget the token locally; do not revoke it"),
			))},
	} {
		cmd, err := cli.BuildCobraCommandFromCommand(c)
		if err != nil {
			return nil, errors.Wrap(err, "auth")
		}
		g.AddCommand(cmd)
	}
	return g, nil
}

type authLogin struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*authLogin)(nil)

func (c *authLogin) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	srv, err := credentials.ResolveServer(a.S("server"))
	if err != nil {
		return err
	}
	if nick := a.S("as"); nick != "" {
		return c.local(ctx, a, out, srv.Server, nick)
	}
	if !a.B("with-token") {
		return c.device(ctx, a, out, srv.Server)
	}
	token, err := readToken(os.Stdin)
	if err != nil {
		return err
	}
	me, err := client.New(srv.Server, token, hostOption(a.S("host"))...).Me(ctx)
	if err != nil {
		return errors.Wrap(loginHint(err), "check the token")
	}
	if me.Token == nil {
		return errors.New("the server did not describe the token")
	}
	return saveLogin(ctx, out, srv.Server, entryFor(token, me.User, *me.Token, a.S("host")), !a.B("no-default"))
}

// local gets a token for a nickname from a server in local mode.
func (c *authLogin) local(ctx context.Context, a in, out middlewares.Processor, origin, nick string) error {
	days, err := a.optI("days")
	if err != nil {
		return err
	}
	d := 30
	if days != nil {
		d = *days
	}
	name := a.S("name")
	if name == "" {
		name = nick
	}
	tok, err := client.New(origin, "", hostOption(a.S("host"))...).LocalToken(ctx, nick, name, a.L("scopes"), d)
	if client.IsCode(err, "not_found") {
		return errors.New("--as works only against a server started with slop serve --local")
	}
	if err != nil {
		return err
	}
	return saveLogin(ctx, out, origin, entryFor(tok.Token, tok.User, tok.Info, a.S("host")), !a.B("no-default"))
}

// devicePollFloor is the shortest wait between polls and deviceSlowDown what
// a slow_down answer adds (RFC 8628 §3.5); tests lower both.
var (
	devicePollFloor = time.Second
	deviceSlowDown  = 5 * time.Second
)

// device logs in through the browser: the server issues a code pair, the user
// approves the code at the printed link, and polling then yields the token.
func (c *authLogin) device(ctx context.Context, a in, out middlewares.Processor, origin string) error {
	days, err := a.optI("days")
	if err != nil {
		return err
	}
	name := a.S("name")
	if name == "" {
		host, _ := os.Hostname()
		name = strings.TrimSpace("slop CLI on " + host)
	}
	if len(name) > 80 {
		name = name[:80]
	}
	api := client.New(origin, "", hostOption(a.S("host"))...)
	dc, err := api.DeviceAuthorize(ctx, name, a.L("scopes"), days)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "To authorize this terminal, open\n  %s\nand check that it shows the code  %s  (expires in %d minutes).\n",
		dc.VerificationURIComplete, dc.UserCode, dc.ExpiresIn/60)
	if shouldOpenBrowser(a.B("no-browser")) && strings.HasPrefix(dc.VerificationURIComplete, origin+"/") {
		_ = openBrowser(dc.VerificationURIComplete)
	}
	fmt.Fprintln(os.Stderr, "Waiting for approval...")
	tok, err := pollDevice(ctx, api, dc)
	if err != nil {
		return err
	}
	return saveLogin(ctx, out, origin, entryFor(tok.Token, tok.User, tok.Info, a.S("host")), !a.B("no-default"))
}

// pollDevice polls until the login is approved, denied or expired. Ctrl-C
// cancels ctx and stops it.
func pollDevice(ctx context.Context, api *client.Client, dc client.DeviceCode) (client.DeviceToken, error) {
	interval := max(time.Duration(dc.Interval)*time.Second, devicePollFloor)
	deadline := time.Now().Add(time.Duration(dc.ExpiresIn) * time.Second)
	for {
		select {
		case <-ctx.Done():
			return client.DeviceToken{}, ctx.Err()
		case <-time.After(interval):
		}
		tok, err := api.DevicePoll(ctx, dc.DeviceCode)
		var apiErr *client.Error
		switch {
		case err == nil:
			return tok, nil
		case client.IsCode(err, "authorization_pending"):
		case client.IsCode(err, "slow_down"):
			interval += deviceSlowDown
		case client.IsCode(err, "access_denied"):
			return tok, errors.New("the login was denied in the browser")
		case client.IsCode(err, "expired_token"):
			return tok, errors.New("the code expired; run slop auth login again")
		case errors.As(err, &apiErr):
			return tok, err
		default: // network trouble: keep trying until the code expires
			fmt.Fprintln(os.Stderr, "slop: "+err.Error()+"; retrying")
		}
		if time.Now().After(deadline) {
			return tok, errors.New("the code expired; run slop auth login again")
		}
	}
}

// shouldOpenBrowser is true on an interactive desktop session.
func shouldOpenBrowser(disabled bool) bool {
	if disabled || os.Getenv("SSH_CONNECTION") != "" || !term.IsTerminal(int(os.Stderr.Fd())) { // #nosec G115 -- a file descriptor fits in int
		return false
	}
	switch runtime.GOOS {
	case "darwin", "windows":
		return true
	}
	return os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url) // #nosec G204 -- our server's URL, passed as one argument
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url) // #nosec G204
	default:
		cmd = exec.Command("xdg-open", url) // #nosec G204
	}
	return cmd.Start()
}

// readToken reads a token from a hidden prompt on a terminal, else from r.
func readToken(r io.Reader) (string, error) {
	var raw []byte
	var err error
	if f, ok := r.(*os.File); ok && term.IsTerminal(int(f.Fd())) { // #nosec G115 -- a file descriptor fits in int
		fmt.Fprint(os.Stderr, "Paste the API token: ")
		raw, err = term.ReadPassword(int(f.Fd())) // #nosec G115
		fmt.Fprintln(os.Stderr)
	} else {
		raw, err = io.ReadAll(io.LimitReader(bufio.NewReader(r), 4096))
	}
	if err != nil {
		return "", errors.Wrap(err, "read the token")
	}
	token := strings.TrimSpace(string(raw))
	if !strings.HasPrefix(token, store.TokenPrefix) {
		return "", errors.Errorf("a personal API token starts with %s", store.TokenPrefix)
	}
	return token, nil
}

func entryFor(token string, u client.MeUser, t client.Token, host string) credentials.Entry {
	return credentials.Entry{Token: token, TokenID: t.ID, Name: t.Name, Scopes: t.Scopes, ExpiresAt: t.ExpiresAt, SavedAt: time.Now().UTC(), Host: host,
		User: credentials.User{ID: u.ID, Name: u.Name, Email: u.Email, Role: u.Role}}
}

// saveLogin stores e for origin and prints it.
func saveLogin(ctx context.Context, out middlewares.Processor, origin string, e credentials.Entry, makeDefault bool) error {
	f, warning, err := credentials.Load()
	if err != nil {
		return err
	}
	if warning != "" {
		fmt.Fprintln(os.Stderr, "slop: "+warning)
	}
	f.Put(origin, e, makeDefault)
	if err = credentials.Save(f); err != nil {
		return err
	}
	if p, err := credentials.Path(); err == nil {
		fmt.Fprintln(os.Stderr, "Saved to "+p)
	}
	return out.AddRow(ctx, loginRow(origin, e, f.Default == origin))
}

func loginRow(origin string, e credentials.Entry, isDefault bool) types.Row {
	expires := "never"
	if e.ExpiresAt != nil {
		expires = e.ExpiresAt.Format(time.DateOnly)
	}
	return types.NewRow(types.MRP("server", origin), types.MRP("default", isDefault), types.MRP("user", e.User.Name), types.MRP("email", e.User.Email),
		types.MRP("role", e.User.Role), types.MRP("scopes", strings.Join(e.Scopes, " ")), types.MRP("expires", expires), types.MRP("token_id", e.TokenID))
}

type authStatus struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*authStatus)(nil)

func (c *authStatus) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	f, warning, err := credentials.Load()
	if err != nil {
		return err
	}
	if warning != "" {
		fmt.Fprintln(os.Stderr, "slop: "+warning)
	}
	only := ""
	if s := a.S("server"); s != "" {
		if only, err = credentials.NormalizeOrigin(s); err != nil {
			return err
		}
	}
	// What a command run now with the same --server would use.
	eff, effErr := credentials.Resolve(credentials.Inputs{Server: a.S("server")})
	origins := make([]string, 0, len(f.Servers))
	for o := range f.Servers {
		if only == "" || o == only {
			origins = append(origins, o)
		}
	}
	sort.Strings(origins)
	rows := 0
	for _, o := range origins {
		e := f.Servers[o]
		row := loginRow(o, e, f.Default == o)
		row.Set("used", usedBy(eff, effErr, o))
		if a.B("check") {
			row.Set("check", check(ctx, o, e.Token, e.Host))
		}
		if err := out.AddRow(ctx, row); err != nil {
			return err
		}
		rows++
	}
	if effErr == nil && eff.TokenSource != credentials.FromFile && (only == "" || eff.Server == only) {
		if _, stored := f.Servers[eff.Server]; !stored {
			row := types.NewRow(types.MRP("server", eff.Server), types.MRP("used", "yes, from "+describe(eff.TokenSource)))
			if a.B("check") {
				row.Set("check", check(ctx, eff.Server, eff.Token, eff.Host))
			}
			if err := out.AddRow(ctx, row); err != nil {
				return err
			}
			rows++
		}
	}
	if rows == 0 {
		fmt.Fprintln(os.Stderr, "Not logged in. Run slop auth login --server URL.")
	}
	return nil
}

// usedBy says whether commands use the stored token for origin.
func usedBy(eff credentials.Resolved, err error, origin string) string {
	if err != nil || eff.Server != origin {
		return ""
	}
	if eff.TokenSource == credentials.FromFile {
		return "yes"
	}
	return "no, overridden by " + describe(eff.TokenSource)
}

func describe(s credentials.Source) string {
	switch s {
	case credentials.FromEnv:
		return "SLOP_TOKEN"
	case credentials.FromTokenFile:
		return "--token-file"
	case credentials.FromFlag, credentials.FromFile:
	}
	return string(s)
}

// check asks the server about a token: "valid" or the error code.
func check(ctx context.Context, origin, token, host string) string {
	if _, err := client.New(origin, token, hostOption(host)...).Me(ctx); err != nil {
		var apiErr *client.Error
		if errors.As(err, &apiErr) {
			return apiErr.Code
		}
		return "unreachable"
	}
	return "valid"
}

type authToken struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*authToken)(nil)

func (c *authToken) Run(_ context.Context, v *values.Values) error {
	a := in{v}
	res, err := credentials.Resolve(credentials.Inputs{Server: a.S("server")})
	if err != nil {
		return err
	}
	if term.IsTerminal(int(os.Stdout.Fd())) && !a.B("yes") { // #nosec G115 -- a file descriptor fits in int
		return errors.New("refusing to print a token to a terminal; redirect the output or pass --yes")
	}
	_, err = fmt.Fprintln(os.Stdout, res.Token)
	return err
}

type authLogout struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*authLogout)(nil)

func (c *authLogout) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	f, _, err := credentials.Load()
	if err != nil {
		return err
	}
	var targets []string
	if a.B("all") {
		for o := range f.Servers {
			targets = append(targets, o)
		}
		sort.Strings(targets)
	} else {
		srv, err := credentials.ResolveServer(a.S("server"))
		if err != nil {
			return err
		}
		if _, ok := f.Servers[srv.Server]; !ok {
			return errors.Errorf("not logged in to %s", srv.Server)
		}
		targets = []string{srv.Server}
	}
	for _, o := range targets {
		revoked := "kept"
		if !a.B("keep-token") {
			revoked = revoke(ctx, o, f.Servers[o])
		}
		f.Remove(o)
		if err := out.AddRow(ctx, types.NewRow(types.MRP("server", o), types.MRP("logged_out", true), types.MRP("token", revoked))); err != nil {
			return err
		}
	}
	return credentials.Save(f)
}

// revoke revokes a stored token on its server: "revoked", "already invalid",
// or "not revoked" with a warning when the server cannot be reached.
func revoke(ctx context.Context, origin string, e credentials.Entry) string {
	err := client.New(origin, e.Token, hostOption(e.Host)...).RevokeSelf(ctx)
	switch {
	case err == nil:
		return "revoked"
	case client.IsCode(err, "token_invalid"):
		return "already invalid"
	}
	fmt.Fprintf(os.Stderr, "slop: could not revoke the token on %s (%v); revoke %q in the Admin screen\n", origin, err, e.Name)
	return "not revoked"
}
