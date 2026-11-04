// Package cmds builds the slop command tree: serve, auth, and one command
// per verb of the verb table.
package cmds

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/commands"
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
		Use:           "slop",
		Short:         "slop: host apps on stores, with a CLI for people and agents",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.PersistentFlags().StringVar(&flagServer, "server", "", "server origin (default: $SLOP_SERVER, then the default login)")
	root.PersistentFlags().StringVarP(&flagOutput, "output", "o", "yaml", "output: yaml, json or table")
	root.AddCommand(serveCmd(), authCmd(), verbsCmd(), verbCmd())
	addVerbCommands(root)
	addExtraCommands(root)
	return root
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
			g = &cobra.Command{Use: v.Group(), Short: "The " + v.Group() + " verbs"}
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
	cmd := &cobra.Command{
		Use:   use,
		Short: v.Doc,
		Args:  cobra.MaximumNArgs(len(pos)),
		RunE: func(cmd *cobra.Command, args []string) error {
			in := map[string]any{}
			if jsonArgs != "" {
				if err := json.Unmarshal([]byte(jsonArgs), &in); err != nil {
					return fmt.Errorf("--json: %w", err)
				}
			}
			for i, s := range args {
				in[pos[i].Name] = convert(pos[i], s)
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
