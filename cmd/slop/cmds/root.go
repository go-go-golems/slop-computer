// Package cmds builds the slop command tree: serve, auth, and one command
// per verb of the verb table.
package cmds

import (
	"encoding/json"
	"fmt"
	"os"
	"runtime/debug"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/go-go-golems/glazed/pkg/help"
	help_cmd "github.com/go-go-golems/glazed/pkg/help/cmd"
	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/commands"
	"github.com/go-go-golems/slop-computer/pkg/doc"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

var (
	flagServer string
	flagOutput string
)

// listOnce fills verbs.Default with the commands, unbound: the CLI only
// lists them (names, arguments, docs) and calls the server.
var listOnce sync.Once

// Root returns the root command.
func Root() *cobra.Command {
	listOnce.Do(func() { commands.Install(verbs.Default, nil) })
	root := &cobra.Command{
		Use:   "slop",
		Short: "slop: host apps on stores, with a CLI for people and agents",
		Long: "slop: host apps on stores, with a CLI for people and agents.\n\n" +
			"Start with `slop help slop-overview` (what slop is) and `slop help agent-quickstart`\n" +
			"(logging in and finding your way); `slop help --all` lists every page.\n" +
			"Every verb has its own --help; `slop verbs` lists them all.",
		SilenceUsage:  true,
		SilenceErrors: true,
		// Check -o before a verb runs: an unknown format used to print YAML
		// after the verb had already done its work.
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			switch flagOutput {
			case "yaml", "json", "table":
				return nil
			}
			return fmt.Errorf("invalid_argument: -o %q: the formats are yaml, json and table", flagOutput)
		},
	}
	// slop --version: the first command an agent tried in two persona runs.
	root.Version = version()
	root.SetVersionTemplate("slop {{.Version}}\n")
	root.PersistentFlags().StringVar(&flagServer, "server", "", "server origin (default: $SLOP_SERVER, then the default login)")
	root.PersistentFlags().StringVarP(&flagOutput, "output", "o", "yaml", "output: yaml, json or table")
	// A wrong flag shows the usage line: persona agents guessed
	// `slop pull --folder` three times before reading --help.
	root.SetFlagErrorFunc(func(c *cobra.Command, err error) error {
		return fmt.Errorf("%w\nusage: %s (slop %s --help)", err, c.UseLine(), strings.TrimPrefix(c.CommandPath(), "slop "))
	})
	root.AddCommand(serveCmd(), authCmd(), verbsCmd(), verbCmd())
	addVerbCommands(root)
	addExtraCommands(root)
	addAppCommands(root)
	setupHelp(root)
	strictGroups(root)
	usageOnArgErrors(root)
	return root
}

// usageOnArgErrors adds the usage line to a wrong number of positional
// arguments, as SetFlagErrorFunc does for flags: "accepts 2 arg(s), received
// 1" alone cost an agent a round trip to --help (round js-3, slop pull).
func usageOnArgErrors(c *cobra.Command) {
	for _, sub := range c.Commands() {
		usageOnArgErrors(sub)
	}
	if check := c.Args; check != nil {
		c.Args = func(cmd *cobra.Command, args []string) error {
			if err := check(cmd, args); err != nil {
				return fmt.Errorf("%w\nusage: %s (slop %s --help)", err, cmd.UseLine(), strings.TrimPrefix(cmd.CommandPath(), "slop "))
			}
			return nil
		}
	}
}

// strictGroups makes a group refuse an unknown subcommand. Cobra prints a
// group's help and exits 0 for `slop store list`, which two persona agents
// read as an answer (SLOP3-026, round 3); now it fails and suggests `ls`.
func strictGroups(c *cobra.Command) {
	for _, sub := range c.Commands() {
		strictGroups(sub)
	}
	if c.HasParent() && c.HasSubCommands() && c.Run == nil && c.RunE == nil {
		c.Args = cobra.ArbitraryArgs
		c.SuggestionsMinimumDistance = 2
		c.RunE = func(cmd *cobra.Command, args []string) error {
			if len(args) == 0 {
				return cmd.Help()
			}
			hint := ""
			if s := cmd.SuggestionsFor(args[0]); len(s) > 0 {
				hint = fmt.Sprintf("; did you mean %q?", s[0])
			}
			return fmt.Errorf("unknown command %q for %q%s (%s --help lists them)", args[0], cmd.CommandPath(), hint, cmd.CommandPath())
		}
	}
}

// version is the build's module version and commit, from Go's build info
// (nothing stamps a version at link time).
func version() string {
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return "(unknown)"
	}
	v, rev, at, dirty := bi.Main.Version, "", "", ""
	for _, s := range bi.Settings {
		switch s.Key {
		case "vcs.revision":
			rev = s.Value
		case "vcs.time":
			at = s.Value
		case "vcs.modified":
			if s.Value == "true" {
				dirty = ", modified"
			}
		}
	}
	if len(rev) > 12 {
		rev = rev[:12]
	}
	if rev != "" {
		v += " (" + rev + " " + at + dirty + ")"
	}
	return v
}

// setupHelp gives the root Glazed's help system with slop's pages
// (pkg/doc): slop help, slop help <slug>, slop help --all.
func setupHelp(root *cobra.Command) {
	hs := help.NewHelpSystem()
	if err := doc.AddDocToHelpSystem(hs); err != nil {
		fmt.Fprintln(os.Stderr, "warning: help pages:", err)
	}
	// Glazed renders command help as markdown. Examples are command lines:
	// keep them verbatim, one per line, in a code block. Its footer names
	// `help <command name>`, which is no page for a nested verb.
	help_cmd.COBRA_COMMAND_USAGE_TEMPLATE = strings.Replace(help_cmd.COBRA_COMMAND_USAGE_TEMPLATE,
		"## Examples:\n{{.Example}}", "## Examples:\n```\n{{.Example}}\n```", 1)
	help_cmd.COBRA_COMMAND_HELP_TEMPLATE = strings.Replace(help_cmd.COBRA_COMMAND_HELP_TEMPLATE,
		"For more help, run:\n`{{$.HelpCommand}} {{.Name}}`", "The help pages: `{{$.HelpCommand}} --all`.", 1)
	help_cmd.SetupCobraRootCommand(hs, root)
	// Short and Long are markdown too: `<store>` would vanish as an HTML tag
	// and `preact@10.24.3` become a mail link. Escape them once, at the
	// first help or usage render, so completions keep the plain text.
	var once sync.Once
	escape := func() { once.Do(func() { escapeHelpText(root) }) }
	helpFn, usageFn := root.HelpFunc(), root.UsageFunc()
	root.SetHelpFunc(func(c *cobra.Command, args []string) { escape(); helpFn(c, args) })
	root.SetUsageFunc(func(c *cobra.Command) error { escape(); return usageFn(c) })
}

func escapeHelpText(c *cobra.Command) {
	c.Short, c.Long = mdEscape(c.Short), mdEscape(c.Long)
	for _, sub := range c.Commands() {
		escapeHelpText(sub)
	}
}

// mdEscape keeps cobra text literal under markdown: runs of indented lines
// (command examples) become code blocks, and outside code < > are escaped
// and @ is written as an entity, which no autolink matches.
func mdEscape(s string) string {
	var b strings.Builder
	lines := strings.Split(s, "\n")
	fence, indented := false, false
	for i, line := range lines {
		isIndented := !fence && strings.HasPrefix(line, "  ") && strings.TrimSpace(line) != "" &&
			!strings.HasPrefix(strings.TrimSpace(line), "- ") && !strings.HasPrefix(strings.TrimSpace(line), "* ")
		if isIndented && !indented {
			b.WriteString("```\n")
		} else if !isIndented && indented {
			b.WriteString("```\n")
		}
		indented = isIndented
		if strings.HasPrefix(strings.TrimSpace(line), "```") {
			fence = !fence
		}
		if fence || indented || strings.HasPrefix(strings.TrimSpace(line), "```") {
			b.WriteString(line)
		} else {
			inCode := false
			for _, r := range line {
				switch {
				case r == '`':
					inCode = !inCode
				case inCode:
				case r == '<' || r == '>':
					b.WriteByte('\\')
				case r == '@':
					b.WriteString("&#64;")
					continue
				}
				b.WriteRune(r)
			}
		}
		if i < len(lines)-1 {
			b.WriteByte('\n')
		}
	}
	if indented {
		b.WriteString("\n```")
	}
	return b.String()
}

// groupShort says what a command group is for and which help page explains
// it ("The alarm verbs" sent an agent to read a long page to learn what an
// alarm is: round js-2).
var groupShort = map[string]string{
	"actor":   "A store's actor (actor.js): call its actions (slop help actors)",
	"alarm":   "Scheduled jobs of a store's actor: list them, run one now or as of a time (slop help alarms)",
	"app":     "The app a store runs: status, logs, restart, verbs, trust (slop help deploying-apps)",
	"bind":    "Read aliases: let a store's actor and pages read another store (slop help store-data)",
	"docs":    "A store's JSON documents (slop help store-data)",
	"explain": "Why someone can or cannot do something on a store (slop help access-control)",
	"files":   "A store's file tree and uploads (slop help store-data)",
	"grant":   "Who has which level on a store: view, interact, admin (slop help access-control)",
	"import":  "Load CSV, JSON or a folder into a store (slop help store-data)",
	"link":    "Share links that give a level on a store (slop help access-control)",
	"llm":     "LLM access and budgets (slop help llm-access)",
	"log":     "A store's commits: what changed, by whom, via what (slop help store-data)",
	"mount":   "Where stores are served: host and path (slop help deploying-apps)",
	"policy":  "An app's capability policy per audience (slop help access-control)",
	"ref":     "A store's refs: which snapshot main and others point at (slop help deploying-apps)",
	"sql":     "A store's SQL tables: query, schema (slop help store-data)",
	"store":   "Stores: list, make, show one, settings (slop store show <store> answers most questions)",
}

// addVerbCommands makes `slop <group> <verb>` for every verb.
func addVerbCommands(root *cobra.Command) {
	groups := map[string]*cobra.Command{}
	for _, v := range verbs.Default.All() {
		v := v
		cmd := verbCommand(v)
		if !strings.Contains(v.Name, ".") {
			root.AddCommand(cmd)
			continue
		}
		g, ok := groups[v.Group()]
		if !ok {
			short := groupShort[v.Group()]
			if short == "" {
				short = "The " + v.Group() + " verbs"
			}
			g = &cobra.Command{Use: v.Group(), Short: short}
			groups[v.Group()] = g
			root.AddCommand(g)
		}
		g.AddCommand(cmd)
	}
}

func verbCommand(v *verbs.Verb) *cobra.Command {
	pos := []verbs.Arg{}
	for _, a := range v.Args {
		if a.Pos > 0 {
			pos = append(pos, a)
		}
	}
	sort.Slice(pos, func(i, j int) bool { return pos[i].Pos < pos[j].Pos })
	use := v.Short()
	for _, a := range pos {
		if a.Required {
			use += " <" + a.Name + ">"
		} else {
			use += " [" + a.Name + "]"
		}
	}
	vals := map[string]*string{}
	var jsonArgs string
	var aliases []string
	if v.Short() == "ls" {
		aliases = []string{"list"} // slop store list (round 3, js-1): agents type it
	}
	cmd := &cobra.Command{
		Use:     use,
		Aliases: aliases,
		Short:   v.Doc,
		Args:    cobra.MaximumNArgs(len(pos)),
		RunE: func(cmd *cobra.Command, args []string) error {
			in := map[string]any{}
			if jsonArgs != "" {
				if err := json.Unmarshal([]byte(jsonArgs), &in); err != nil {
					return fmt.Errorf("--json: %w", err)
				}
			}
			// A positional given as a flag leaves its slot to the next
			// argument: preview url dash --at main <parent> put the parent
			// in at's slot and then lost it to --at (round js-1). With more
			// arguments than free slots, they fill the slots in order.
			slots := pos
			free := []verbs.Arg{}
			for _, a := range pos {
				if !cmd.Flags().Changed(a.Name) {
					free = append(free, a)
				}
			}
			if len(args) <= len(free) {
				slots = free
			}
			for i, s := range args {
				in[slots[i].Name] = convert(slots[i], s)
			}
			for _, a := range v.Args {
				if cmd.Flags().Changed(a.Name) {
					in[a.Name] = convert(a, *vals[a.Name])
				}
			}
			c, err := client.Resolve(flagServer)
			if err != nil {
				return err
			}
			var res any
			if v.Effect == verbs.EffectStream {
				// parts with a delta show on stderr as they arrive; the
				// result is printed as usual
				streamed := false
				res, err = c.CallStream(v.Name, in, func(raw json.RawMessage) {
					var p struct{ Delta string }
					if json.Unmarshal(raw, &p) == nil && p.Delta != "" {
						_, _ = fmt.Fprint(cmd.ErrOrStderr(), p.Delta)
						streamed = true
					}
				})
				if streamed {
					_, _ = fmt.Fprintln(cmd.ErrOrStderr())
				}
			} else {
				res, err = c.Call(v.Name, in)
			}
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	for _, a := range v.Args {
		s := ""
		vals[a.Name] = &s
		cmd.Flags().StringVar(vals[a.Name], a.Name, "", a.Doc)
		if a.Type == "bool" {
			// `--all` alone means true; `--all=false` turns it off. Without
			// this a bare bool flag took the next word as its value.
			cmd.Flags().Lookup(a.Name).NoOptDefVal = "true"
		}
	}
	cmd.Flags().StringVar(&jsonArgs, "json", "", "all arguments as a JSON object")
	return cmd
}

// convert turns a command-line string into the argument's type.
func convert(a verbs.Arg, s string) any {
	switch a.Type {
	case "int":
		if n, err := strconv.ParseInt(s, 10, 64); err == nil {
			return n
		}
	case "bool":
		return s == "" || s == "true" || s == "1" || s == "yes" || s == "on"
	case "json":
		// UseNumber: a number keeps every digit on its way to the server
		// (9007199254740993 would become …992 as a float64).
		dec := json.NewDecoder(strings.NewReader(s))
		dec.UseNumber()
		var v any
		if dec.Decode(&v) == nil && !dec.More() {
			return v
		}
	}
	return s
}

func verbsCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "verbs",
		Short: "List the verbs this CLI knows",
		RunE: func(cmd *cobra.Command, args []string) error {
			rows := []any{}
			for _, v := range verbs.Default.All() {
				typed := ""
				if v.Input != nil {
					typed = "typed"
				}
				rows = append(rows, map[string]any{"verb": v.Name, "effect": string(v.Effect), "schema": typed, "doc": v.Doc})
			}
			return printOut(rows)
		},
	}
	cmd.AddCommand(&cobra.Command{
		Use:   "tools [verb...]",
		Short: "Describe verbs as MCP tools: name, description, input and output JSON Schema",
		RunE: func(cmd *cobra.Command, args []string) error {
			out := []any{}
			for _, v := range verbs.Default.All() {
				if len(args) == 0 || slices.Contains(args, v.Name) {
					out = append(out, v.Tool())
				}
			}
			if len(out) == 0 {
				return fail("no such verb: %s", strings.Join(args, ", "))
			}
			return printOut(out)
		},
	})
	return cmd
}

func verbCmd() *cobra.Command {
	var jsonArgs string
	cmd := &cobra.Command{
		Use:   "verb <name>",
		Short: "Call any verb by name with --json arguments (for verbs newer than this CLI)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			in := map[string]any{}
			if jsonArgs != "" {
				if err := json.Unmarshal([]byte(jsonArgs), &in); err != nil {
					return err
				}
			}
			c, err := client.Resolve(flagServer)
			if err != nil {
				return err
			}
			res, err := c.Call(args[0], in)
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&jsonArgs, "json", "", "arguments as a JSON object")
	return cmd
}

func fail(format string, args ...any) error {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	return fmt.Errorf(format, args...)
}
