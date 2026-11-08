package cmds

// slop on <store> …: the command-line verbs an app ships (SLOP3-016). The
// verbs are JavaScript in the app's tree (manifest slop.verbs); this command
// fetches them for the store (app.verbs, cached per app snapshot), scans
// them with go-go-goja's jsverbs, and runs the rest of the command line
// against them, locally, with a slop module scoped to that store. An app
// with an alias (Pinboard: pb) also gets slop <alias> <store> … once the CLI
// has seen it.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/appverbs"
	"github.com/go-go-golems/slop-computer/pkg/client"
)

// aliasInfo is what the CLI remembers about an app with an alias.
type aliasInfo struct {
	App   string `json:"app"`
	Type  string `json:"type,omitempty"`
	Title string `json:"title,omitempty"` // the document whose "title" names a store
}

// verbsDir is where app verbs are cached for a server: one directory per
// server URL (scheme, host and path), not per host, so that two servers on
// one host never share cached verbs (SLOP3-017 F5). The host prefix keeps
// the name readable; the hash keeps it distinct.
func verbsDir(server string) string {
	base, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(base, "slop", "verbs", serverKey(server))
}

func serverKey(server string) string {
	norm, host := strings.TrimRight(strings.TrimSpace(server), "/"), ""
	if u, err := url.Parse(norm); err == nil && u.Host != "" {
		u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
		u.RawQuery, u.Fragment = "", ""
		u.Path = strings.TrimRight(u.Path, "/")
		norm, host = u.String(), u.Host
	}
	if host == "" {
		host = "server"
	}
	sum := sha256.Sum256([]byte(norm))
	return strings.NewReplacer(":", "_", "/", "_").Replace(host) + "-" + hex.EncodeToString(sum[:6])
}

// knownAliases reads the aliases the CLI has seen, on every server it has
// cached verbs for (the server is not known before the flags are parsed).
func knownAliases() map[string]aliasInfo {
	out := map[string]aliasInfo{}
	base, err := os.UserConfigDir()
	if err != nil {
		return out
	}
	files, _ := filepath.Glob(filepath.Join(base, "slop", "verbs", "*", "aliases.json"))
	for _, f := range files {
		m := map[string]aliasInfo{}
		if b, err := os.ReadFile(f); err == nil && json.Unmarshal(b, &m) == nil {
			for k, v := range m {
				out[k] = v
			}
		}
	}
	return out
}

func rememberAlias(dir, alias string, info aliasInfo) {
	if dir == "" || alias == "" {
		return
	}
	p := filepath.Join(dir, "aliases.json")
	m := map[string]aliasInfo{}
	if b, err := os.ReadFile(p); err == nil {
		_ = json.Unmarshal(b, &m)
	}
	if m[alias] == info {
		return
	}
	m[alias] = info
	_ = os.MkdirAll(dir, 0o700)
	if b, err := json.MarshalIndent(m, "", "  "); err == nil {
		_ = os.WriteFile(p, b, 0o600)
	}
}

// addAppCommands adds slop on and one command per known alias that does
// not shadow a built-in command (slop app is the app verb group).
func addAppCommands(root *cobra.Command) {
	taken := map[string]bool{}
	for _, c := range root.Commands() {
		taken[c.Name()] = true
	}
	if !taken["on"] {
		root.AddCommand(appCommand("on", nil))
		taken["on"] = true
	}
	aliases := knownAliases()
	names := make([]string, 0, len(aliases))
	for a := range aliases {
		names = append(names, a)
	}
	sort.Strings(names)
	for _, a := range names {
		if taken[a] {
			continue
		}
		info := aliases[a]
		root.AddCommand(appCommand(a, &info))
	}
}

func appCommand(name string, alias *aliasInfo) *cobra.Command {
	short := "Run the command-line verbs of the app a store runs (slop on <store> --help lists them)"
	if alias != nil {
		short = "The " + alias.App + " app's verbs: slop " + name + " <" + orStore(alias.Type) + "> …"
	}
	return &cobra.Command{
		Use:                name + " <store> [command…]",
		Short:              short,
		DisableFlagParsing: true,
		Args:               cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runAppVerbs(cmd, name, alias, args)
		},
	}
}

func orStore(t string) string {
	if t == "" {
		return "store"
	}
	return t
}

func runAppVerbs(cmd *cobra.Command, name string, alias *aliasInfo, args []string) error {
	// Flag parsing is off (the verbs have their own flags), so --server is
	// taken out here.
	rest := []string{}
	for i := 0; i < len(args); i++ {
		switch a := args[i]; {
		case a == "--server" && i+1 < len(args):
			flagServer = args[i+1]
			i++
		case strings.HasPrefix(a, "--server="):
			flagServer = strings.TrimPrefix(a, "--server=")
		default:
			rest = append(rest, a)
		}
	}
	if len(rest) == 0 || rest[0] == "-h" || rest[0] == "--help" {
		_, _ = fmt.Fprintf(cmd.OutOrStdout(), "Usage: slop %s <%s> <command> [flags]\n\nRuns the verbs the app ships, on that %s, as you. slop %s <%s> --help lists them.\n", name, orStore(typeOf(alias)), orStore(typeOf(alias)), name, orStore(typeOf(alias)))
		return nil
	}
	c, err := resolve()
	if err != nil {
		return err
	}
	dir := verbsDir(c.Server)
	board, src, err := resolveBoard(c, dir, alias, rest[0])
	if err != nil {
		return err
	}
	if len(src.Files) == 0 {
		return fmt.Errorf("%s runs %s, which ships no command-line verbs", board.ID, src.App)
	}
	rememberAlias(dir, src.Alias, aliasInfo{App: src.App, Type: src.Type, Title: src.Title})
	label := board.ID
	if board.Title != "" {
		label = board.Title + " (" + board.ID + ")"
	}
	return appverbs.Execute(cmd.Context(), src, c, board, []string{"slop", name, rest[0]}, src.App+"'s verbs on "+label, rest[1:], cmd.OutOrStdout(), cmd.ErrOrStderr())
}

func typeOf(a *aliasInfo) string {
	if a == nil {
		return ""
	}
	return a.Type
}

// resolveBoard finds the store a command names: an id, or a title among the
// person's stores of the alias's type (the title is the "title" field of the
// document the app names, such as board/meta).
func resolveBoard(c *client.Client, dir string, alias *aliasInfo, arg string) (appverbs.Board, *appverbs.Source, error) {
	src, err := appverbs.Fetch(c, arg, dir)
	if err == nil {
		b := appverbs.Board{ID: arg, Type: src.Type, App: src.App, Via: "cli"}
		if src.Title != "" {
			b.Title = titleOf(c, arg, src.Title)
		}
		return b, src, nil
	}
	var ae *client.APIError
	if !errors.As(err, &ae) || (ae.Code != "not_found" && ae.Code != "invalid_argument") {
		return appverbs.Board{}, nil, err
	}
	if alias == nil || alias.Title == "" {
		return appverbs.Board{}, nil, fmt.Errorf("no store %q (give a store id; titles work with an app's alias, such as slop pb <title>)", arg)
	}
	res, err := c.Call("store.ls", nil)
	if err != nil {
		return appverbs.Board{}, nil, err
	}
	rows, _ := res.([]any)
	matches := []appverbs.Board{}
	for _, r := range rows {
		m, _ := r.(map[string]any)
		id, _ := m["id"].(string)
		if t, _ := m["type"].(string); id == "" || (alias.Type != "" && t != alias.Type) {
			continue
		}
		if t := titleOf(c, id, alias.Title); strings.EqualFold(t, arg) {
			matches = append(matches, appverbs.Board{ID: id, Title: t, Type: alias.Type, App: alias.App, Via: "cli"})
		}
	}
	switch len(matches) {
	case 0:
		return appverbs.Board{}, nil, fmt.Errorf("none of your %ss is called %q (slop store ls lists them)", orStore(alias.Type), arg)
	case 1:
		src, err := appverbs.Fetch(c, matches[0].ID, dir)
		return matches[0], src, err
	}
	ids := []string{}
	for _, m := range matches {
		ids = append(ids, m.ID)
	}
	return appverbs.Board{}, nil, fmt.Errorf("%d of your %ss are called %q: %s; give the id", len(matches), orStore(alias.Type), arg, strings.Join(ids, ", "))
}

// titleOf reads the "title" field of a store's document, or "".
func titleOf(c *client.Client, store, path string) string {
	res, err := c.Call("docs.get", map[string]any{"store": store, "path": path})
	if err != nil {
		return ""
	}
	m, _ := res.(map[string]any)
	if d, ok := m["body"].(map[string]any); ok {
		m = d
	}
	t, _ := m["title"].(string)
	return t
}
