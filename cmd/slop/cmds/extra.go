package cmds

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/tscompile"
)

// addExtraCommands adds the commands that work with local files (push,
// pull, eval, the importers, store export --folder, files cat), ref move
// (which reads the ref when --ifAt is not given) and the call shorthand
// for actor.call. Where a
// verb of the same name exists, the local command replaces its generated
// one (and still calls that verb).
func addExtraCommands(root *cobra.Command) {
	for _, cmd := range []*cobra.Command{pushCmd(), pullCmd(), devCmd(), evalCmd(), callCmd(), vendorCmd()} {
		for _, c := range root.Commands() {
			if c.Name() == cmd.Name() {
				root.RemoveCommand(c) // the generated eval
			}
		}
		root.AddCommand(cmd)
	}
	replace(root, "import", importDocsCmd(), importTableCmd(), importFilesCmd(), importFolderCmd())
	replace(root, "store", storeExportCmd())
	replace(root, "ref", refMoveCmd())
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
	var ifAt int64
	cmd := &cobra.Command{
		Use:   "push <dir>",
		Short: "Replace a store's tree with a folder and snapshot it onto a ref (only changed bytes are sent)",
		Long: `Replace the tree of a store's ref with a folder and snapshot it: files the
folder does not have are deleted. Only the bytes the server lacks are sent.

The push applies only if the ref still points where --ifAt says (0: the ref
does not exist yet); without --ifAt the ref is read just before the push. A
ref that moved in between is answered with conflict, and nothing is written.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			if storeID == "" {
				abs, _ := filepath.Abs(args[0])
				storeID = filepath.Base(abs)
			}
			in := map[string]any{"message": message, "ref": ref}
			if cmd.Flags().Changed("ifAt") {
				in["ifAt"] = ifAt
			}
			res, err := c.Push(storeID, args[0], in)
			if err != nil {
				return err
			}
			return printOut(res)
		},
	}
	cmd.Flags().StringVar(&storeID, "store", "", "the store (default: the folder's name)")
	cmd.Flags().StringVarP(&message, "message", "m", "", "snapshot message")
	cmd.Flags().StringVar(&ref, "ref", "", "the ref to move (default main)")
	cmd.Flags().Int64Var(&ifAt, "ifAt", 0, "push only if the ref points at this snapshot (0: it does not exist yet); default: where it points now")
	return cmd
}

// refMoveCmd is ref.move with --ifAt optional: without it the ref is read
// first, and the move says where it moved the ref from.
func refMoveCmd() *cobra.Command {
	var ifAt int64
	cmd := &cobra.Command{
		Use:   "move <store> <ref> <n>",
		Short: "Point a ref at a snapshot (main: publish, or roll back), only if it is still where --ifAt says",
		Long: `Point a store's ref at snapshot n. The move applies only if the ref points
at --ifAt now (0: it does not exist yet), so two publishers cannot overwrite
each other: otherwise the answer is conflict and nothing moves. Without
--ifAt the ref is read first and the move prints "ref: from → to".`,
		Args: cobra.ExactArgs(3),
		RunE: func(cmd *cobra.Command, args []string) error {
			n, err := strconv.ParseInt(args[2], 10, 64)
			if err != nil {
				return fmt.Errorf("n must be a snapshot number: %w", err)
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			from, read := ifAt, !cmd.Flags().Changed("ifAt")
			if read {
				if from, err = c.RefAt(args[0], args[1]); err != nil {
					return err
				}
			}
			res, err := c.Call("ref.move", map[string]any{"store": args[0], "ref": args[1], "n": n, "ifAt": from})
			if err != nil {
				return err
			}
			if read {
				_, _ = fmt.Fprintf(cmd.ErrOrStderr(), "%s: %d → %d\n", args[1], from, n)
			}
			return printOut(res)
		},
	}
	cmd.Flags().Int64Var(&ifAt, "ifAt", 0, "move only if the ref points at this snapshot now (0: it does not exist yet); default: where it points now")
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
	var readOnly, ts bool
	cmd := &cobra.Command{
		Use:   "eval [-f prog.js | -f prog.ts | -e 'source']",
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
			// A .ts program is TypeScript; --ts says so for -e and stdin.
			if ts || tscompile.Is(file) {
				in["ts"] = true
			}
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
	cmd.Flags().BoolVar(&ts, "ts", false, "the program is TypeScript (the default for a .ts file)")
	return cmd
}

// callCmd is actor.call with the arguments as one JSON value.
func callCmd() *cobra.Command {
	var as string
	cmd := &cobra.Command{
		Use:   "call <store> <action> [json]",
		Short: "Call an action of a store's actor",
		Args:  cobra.RangeArgs(2, 3),
		RunE: func(cmd *cobra.Command, args []string) error {
			in := map[string]any{"store": args[0], "action": args[1]}
			if as != "" {
				in["as"] = as
			}
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
	cmd.Flags().StringVar(&as, "as", "", "anonymous, or a person (usr_… or email): run the action as them, with their level and audience (platform admins)")
	return cmd
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
