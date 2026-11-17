package cmds

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/npmvendor"
)

// vendorCmd is slop vendor: npm packages added to an app as ordinary files
// (SLOP3-024, design §4.7). Only a person runs it; the server never fetches
// packages, and the agent in the bench cannot add them.
func vendorCmd() *cobra.Command {
	var dir, store string
	cmd := &cobra.Command{
		Use:   "vendor",
		Short: "Add npm packages to an app as files (bundled once, pinned, checked)",
		Long: `slop vendor fetches a package and its dependencies from the npm registry,
checks each tarball against the registry's integrity hash, bundles the entry
points you name with esbuild, and writes the result into the app's vendor/
folder with the packages' declarations. The names are mapped in app.json
(slop.imports): pages get an import map, the actor's require finds them.
vendor/vendor.json records versions, integrity hashes and every file's sha256.

  slop vendor add preact@10.24.3 preact preact/hooks preact/jsx-runtime
  slop vendor add --actor zod@3.23.8
  slop vendor                 # list, and check every file against the lock
  slop vendor rm preact

It works on an app's folder (--dir, default .), or with --store on an app
store's draft: pulled, changed on this machine, and pushed back as one
snapshot (only if the draft has not moved meanwhile).

With no package scripts run: npm is never run, tarballs are only read.`,
		Args: cobra.NoArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			return onApp(dir, store, false, "", func(d string) error {
				st, err := npmvendor.Check(d)
				if err != nil {
					return err
				}
				if err := printOut(st); err != nil {
					return err
				}
				for _, s := range st {
					if len(s.Problems) > 0 {
						return errors.New("some vendored files are missing or changed")
					}
				}
				return nil
			})
		},
	}
	cmd.PersistentFlags().StringVar(&dir, "dir", ".", "the app's folder")
	cmd.PersistentFlags().StringVar(&store, "store", "", "an app store: change its draft instead of a folder")

	var actor bool
	var registry string
	add := &cobra.Command{
		Use:   "add <package[@version or range]> [import names…]",
		Short: "Vendor a package: bundle the import names given (default: the package itself)",
		Args:  cobra.MinimumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			msg := "slop vendor add " + strings.Join(args, " ")
			return onApp(dir, store, true, msg, func(d string) error {
				res, err := npmvendor.Add(cmd.Context(), npmvendor.Options{Dir: d, Spec: args[0], Entries: args[1:], Actor: actor,
					Registry: &npmvendor.Registry{URL: registry}})
				if err != nil {
					return err
				}
				for _, w := range res.Warnings {
					fmt.Fprintln(os.Stderr, "note:", w)
				}
				return printOut(res)
			})
		},
	}
	add.Flags().BoolVar(&actor, "actor", false, "bundle for the actor (CommonJS for goja) instead of for pages")
	add.Flags().StringVar(&registry, "registry", npmvendor.DefaultRegistry, "the npm registry")

	rm := &cobra.Command{
		Use:   "rm <package>",
		Short: "Remove a vendored package, its files and its names",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			return onApp(dir, store, true, "slop vendor rm "+args[0], func(d string) error {
				res, err := npmvendor.Remove(d, args[0])
				if err != nil {
					return err
				}
				return printOut(res)
			})
		},
	}
	cmd.AddCommand(add, rm)
	return cmd
}

// onApp runs fn on the app's folder, or, with a store, on a copy of its
// draft pulled into a temporary folder; write pushes the copy back to the
// draft, only if the draft still points where it did.
func onApp(dir, store string, write bool, msg string, fn func(dir string) error) error {
	if store == "" {
		return fn(dir)
	}
	c, err := resolve()
	if err != nil {
		return err
	}
	res, err := c.Call("ref.ls", map[string]any{"store": store})
	if err != nil {
		return err
	}
	// The client decodes numbers as json.Number: read the refs back as ints.
	raw, err := json.Marshal(res)
	if err != nil {
		return err
	}
	refs := map[string]int64{}
	if err := json.Unmarshal(raw, &refs); err != nil {
		return fmt.Errorf("ref.ls: %v", err)
	}
	at, ifAt := "draft", refs["draft"]
	if ifAt == 0 {
		at = "main" // no draft yet: start from main; ifAt 0 creates the draft
	}
	tmp, err := os.MkdirTemp("", "slop-vendor-store-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(tmp) }()
	if _, err := c.Pull(store, tmp, at); err != nil {
		return err
	}
	if err := fn(tmp); err != nil || !write {
		return err
	}
	pushed, err := c.Push(store, tmp, map[string]any{"ref": "draft", "ifAt": ifAt, "message": msg})
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "pushed to %s's draft: %v\n", store, pushed)
	return nil
}
