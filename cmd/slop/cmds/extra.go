package cmds

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// addExtraCommands adds the commands that work with local files (push,
// pull, eval, the importers, store export --folder, files cat) and the
// call shorthand for actor.call. Where a
// verb of the same name exists, the local command replaces its generated
// one (and still calls that verb).
func addExtraCommands(root *cobra.Command) {
	for _, cmd := range []*cobra.Command{pushCmd(), pullCmd(), evalCmd(), callCmd()} {
		for _, c := range root.Commands() {
			if c.Name() == cmd.Name() {
				root.RemoveCommand(c) // the generated eval
			}
		}
		root.AddCommand(cmd)
	}
	replace(root, "import", importDocsCmd(), importTableCmd(), importFilesCmd(), importFolderCmd())
	replace(root, "store", storeExportCmd())
	replace(root, "files", filesCatCmd())
}

// replace swaps subcommands of group for cmds with the same names.
func replace(root *cobra.Command, group string, cmds ...*cobra.Command) {
	var g *cobra.Command
	for _, c := range root.Commands() {
		if c.Name() == group {
			g = c
		}
	}
	if g == nil {
		g = &cobra.Command{Use: group, Short: "The " + group + " verbs"}
		root.AddCommand(g)
	}
	for _, cmd := range cmds {
		for _, c := range g.Commands() {
			if c.Name() == cmd.Name() {
				g.RemoveCommand(c)
			}
		}
		g.AddCommand(cmd)
	}
}

func resolve() (*client.Client, error) { return client.Resolve(flagServer) }

func pushCmd() *cobra.Command {
	var storeID, message, ref string
	var noPrune bool
	cmd := &cobra.Command{
		Use:   "push <dir>",
		Short: "Replace a store's tree with a folder and snapshot it (only changed bytes are sent)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			if storeID == "" {
				abs, _ := filepath.Abs(args[0])
				storeID = filepath.Base(abs)
			}
			res, err := c.Push(storeID, args[0], map[string]any{"message": message, "ref": ref, "prune": !noPrune})
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&storeID, "store", "", "the store (default: the folder's name)")
	cmd.Flags().StringVarP(&message, "message", "m", "", "snapshot message")
	cmd.Flags().StringVar(&ref, "ref", "", "the ref to move (default main)")
	cmd.Flags().BoolVar(&noPrune, "no-prune", false, "keep tree files that are not in the folder")
	return cmd
}

func pullCmd() *cobra.Command {
	var at string
	cmd := &cobra.Command{
		Use:   "pull <store> <dir>",
		Short: "Write a store's tree into a folder",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			n, err := c.Pull(args[0], args[1], at)
			if err != nil {
				return err
			}
			return printOut(map[string]any{"written": n, "dir": args[1]})
		},
	}
	cmd.Flags().StringVar(&at, "at", "main", "a snapshot number or ref; empty for the working tree")
	return cmd
}

func evalCmd() *cobra.Command {
	var file, expr, argsJSON string
	var readOnly bool
	cmd := &cobra.Command{
		Use:   "eval [-f prog.js | -e 'source']",
		Short: "Run a JavaScript program on the server with every verb in scope as slop.<group>.<verb>(args)",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			src := expr
			switch {
			case file == "-":
				b, err := io.ReadAll(os.Stdin)
				if err != nil {
					return err
				}
				src = string(b)
			case file != "":
				b, err := os.ReadFile(file)
				if err != nil {
					return err
				}
				src = string(b)
			}
			if src == "" {
				return errors.New("give -f prog.js, -f - (stdin) or -e 'source'")
			}
			in := map[string]any{"source": src, "readOnly": readOnly}
			if argsJSON != "" {
				var v any
				if err := json.Unmarshal([]byte(argsJSON), &v); err != nil {
					return fmt.Errorf("--args: %w", err)
				}
				in["args"] = v
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			res, err := c.Call("eval", in)
			if err != nil {
				var ae *client.APIError
				if errors.As(err, &ae) {
					printLogs(ae.Extra)
				}
				return err
			}
			m, _ := res.(map[string]any)
			printLogs(m)
			return printOut(m["result"])
		},
	}
	cmd.Flags().StringVarP(&file, "file", "f", "", "the program file (- for stdin)")
	cmd.Flags().StringVarP(&expr, "expr", "e", "", "the program source")
	cmd.Flags().StringVar(&argsJSON, "args", "", "JSON passed to the program as args")
	cmd.Flags().BoolVar(&readOnly, "read-only", false, "writing verbs throw permission_denied")
	return cmd
}

// callCmd is actor.call with the arguments as one JSON value.
func callCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "call <store> <action> [json]",
		Short: "Call an action of a store's actor",
		Args:  cobra.RangeArgs(2, 3),
		RunE: func(cmd *cobra.Command, args []string) error {
			in := map[string]any{"store": args[0], "action": args[1]}
			if len(args) == 3 {
				var v any
				if err := json.Unmarshal([]byte(args[2]), &v); err != nil {
					return fmt.Errorf("arguments: %w", err)
				}
				in["args"] = v
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			res, err := c.Call("actor.call", in)
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
}

// printLogs writes a program's console output to stderr.
func printLogs(v any) {
	m, _ := v.(map[string]any)
	logs, _ := m["logs"].([]any)
	for _, l := range logs {
		fmt.Fprintln(os.Stderr, l)
	}
}

// formatOf guesses csv, jsonl or json from a file name.
func formatOf(path, given string) string {
	if given != "" {
		return given
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".csv":
		return "csv"
	case ".jsonl", ".ndjson":
		return "jsonl"
	}
	return "json"
}

func importDocsCmd() *cobra.Command {
	var storeID, coll, idField, format string
	var raw bool
	cmd := &cobra.Command{
		Use:   "docs <file>",
		Short: "Import a CSV, JSONL or JSON array as documents (one commit per 500)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			b, err := os.ReadFile(args[0])
			if err != nil {
				return err
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			res, err := c.Call("import.docs", map[string]any{"store": storeID, "coll": coll, "id": idField,
				"text": string(b), "format": formatOf(args[0], format), "raw": raw})
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&storeID, "store", "", "the store")
	cmd.Flags().StringVar(&coll, "coll", "", "the collection")
	cmd.Flags().StringVar(&idField, "id", "", "the field holding each document's id (default: generated)")
	cmd.Flags().StringVar(&format, "format", "", "csv, jsonl or json (default: from the extension)")
	cmd.Flags().BoolVar(&raw, "raw", false, "keep CSV values as strings")
	_ = cmd.MarkFlagRequired("store")
	_ = cmd.MarkFlagRequired("coll")
	return cmd
}

func importTableCmd() *cobra.Command {
	var storeID, table, format string
	cmd := &cobra.Command{
		Use:   "table <file>",
		Short: "Insert a CSV, JSONL or JSON array into an app table",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			b, err := os.ReadFile(args[0])
			if err != nil {
				return err
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			res, err := c.Call("import.table", map[string]any{"store": storeID, "table": table,
				"text": string(b), "format": formatOf(args[0], format)})
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&storeID, "store", "", "the store")
	cmd.Flags().StringVar(&table, "table", "", "the table")
	cmd.Flags().StringVar(&format, "format", "", "csv, jsonl or json (default: from the extension)")
	_ = cmd.MarkFlagRequired("store")
	_ = cmd.MarkFlagRequired("table")
	return cmd
}

func importFilesCmd() *cobra.Command {
	var storeID, zone string
	cmd := &cobra.Command{
		Use:   "files <dir>",
		Short: "Add a folder's files to a zone, without pruning or a snapshot",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			files, data, err := client.ReadDir(args[0])
			if err != nil {
				return err
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			blobs := map[string]string{}
			for sum, b := range data {
				blobs[sum] = base64.StdEncoding.EncodeToString(b)
			}
			if _, err := c.Call("files.blobs", map[string]any{"store": storeID, "blobs": blobs}); err != nil {
				return err
			}
			res, err := c.Call("import.files", map[string]any{"store": storeID, "zone": zone, "files": files})
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&storeID, "store", "", "the store")
	cmd.Flags().StringVar(&zone, "zone", "tree", "tree or assets")
	_ = cmd.MarkFlagRequired("store")
	return cmd
}

func importFolderCmd() *cobra.Command {
	var storeID string
	cmd := &cobra.Command{
		Use:   "folder <dir>",
		Short: "Make a new store from an exported folder (store.json, docs.jsonl, tree/, assets/, tables/)",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			res, err := c.ImportFolder(args[0], storeID)
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&storeID, "store", "", "the new store's id (default: the exported id)")
	return cmd
}

func storeExportCmd() *cobra.Command {
	var folder string
	cmd := &cobra.Command{
		Use:   "export <id>",
		Short: "Export a store: --folder writes the folder format; otherwise the bundle is printed",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			if folder == "" {
				res, err := c.Call("store.export", map[string]any{"id": args[0]})
				if err != nil {
					return err
				}
				return printOut(res)
			}
			if err := c.ExportFolder(args[0], folder); err != nil {
				return err
			}
			return printOut(map[string]any{"exported": args[0], "folder": folder})
		},
	}
	cmd.Flags().StringVar(&folder, "folder", "", "write the folder format here")
	return cmd
}

func filesCatCmd() *cobra.Command {
	var zone, at string
	cmd := &cobra.Command{
		Use:   "cat <store> <path>",
		Short: "Write a file's bytes to stdout",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			res, err := c.Call("files.cat", map[string]any{"store": args[0], "path": args[1], "zone": zone, "at": at, "as": "base64"})
			if err != nil {
				return err
			}
			m, _ := res.(map[string]any)
			b, err := base64.StdEncoding.DecodeString(fmt.Sprint(m["data"]))
			if err != nil {
				return err
			}
			_, err = os.Stdout.Write(b)
			return err
		},
	}
	cmd.Flags().StringVar(&zone, "zone", "", "tree (default) or assets")
	cmd.Flags().StringVar(&at, "at", "", "a snapshot number or ref; empty for the working tree")
	return cmd
}
