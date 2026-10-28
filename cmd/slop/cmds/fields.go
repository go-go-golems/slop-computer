// Package cmds contains the slop CLI's Glazed commands.
package cmds

import (
	"github.com/go-go-golems/glazed/pkg/cli"
	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/schema"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
)

// in reads parsed flag values by name (copied from francois cmd/francois/cmds/api.go).
type in struct{ v *values.Values }

func (a in) raw(name string) any {
	f, ok := a.v.GetField(schema.DefaultSlug, name)
	if !ok || f == nil {
		return nil
	}
	return f.Value
}

func (a in) S(name string) string { s, _ := a.raw(name).(string); return s }
func (a in) B(name string) bool   { b, _ := a.raw(name).(bool); return b }
func (a in) I(name string) int {
	switch n := a.raw(name).(type) {
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}
func (a in) L(name string) []string { l, _ := a.raw(name).([]string); return l }

func arg(name, help string) *fields.Definition {
	return fields.New(name, fields.TypeString, fields.WithIsArgument(true), fields.WithRequired(true), fields.WithHelp(help))
}

func optArg(name, help string) *fields.Definition {
	return fields.New(name, fields.TypeString, fields.WithIsArgument(true), fields.WithHelp(help))
}

func flag(name, help string) *fields.Definition {
	return fields.New(name, fields.TypeString, fields.WithHelp(help))
}

func flagDefault(name, def, help string) *fields.Definition {
	return fields.New(name, fields.TypeString, fields.WithDefault(def), fields.WithHelp(help))
}

func list(name, help string) *fields.Definition {
	return fields.New(name, fields.TypeStringList, fields.WithHelp(help))
}

func boolean(name, help string) *fields.Definition {
	return fields.New(name, fields.TypeBool, fields.WithDefault(false), fields.WithHelp(help))
}

func integer(name string, def int, help string) *fields.Definition {
	return fields.New(name, fields.TypeInteger, fields.WithDefault(def), fields.WithHelp(help))
}

// group builds a cobra group from Glazed commands.
func group(use, short string, cs ...glazed.Command) (*cobra.Command, error) {
	g := &cobra.Command{Use: use, Short: short}
	for _, c := range cs {
		cmd, err := cli.BuildCobraCommandFromCommand(c)
		if err != nil {
			return nil, errors.Wrap(err, use)
		}
		g.AddCommand(cmd)
	}
	return g, nil
}

// Register adds every slop command to root.
func Register(root *cobra.Command) error {
	top, users := dbCommands()
	for _, c := range append([]glazed.Command{newServe()}, top...) {
		cmd, err := cli.BuildCobraCommandFromCommand(c)
		if err != nil {
			return err
		}
		root.AddCommand(cmd)
	}
	auth, err := authCommands()
	if err != nil {
		return err
	}
	usersGroup, err := group("users", "Manage users directly in the database (bootstrap and break-glass)", users...)
	if err != nil {
		return err
	}
	dbGroup := &cobra.Command{Use: "db", Short: "Direct database operations for operators"}
	dbGroup.AddCommand(usersGroup)
	gc, err := cli.BuildCobraCommandFromCommand(newGCBlobs())
	if err != nil {
		return err
	}
	dbGroup.AddCommand(gc)
	admins, err := cli.BuildCobraCommandFromCommand(newImportAdmins())
	if err != nil {
		return err
	}
	dbGroup.AddCommand(admins)
	importFrancois, err := group("francois", "Import a francois catalog", newImportExtract(), newImportPush())
	if err != nil {
		return err
	}
	importGroup := &cobra.Command{Use: "import", Short: "Import content from other systems"}
	importGroup.AddCommand(importFrancois)
	root.AddCommand(auth, dbGroup, importGroup)
	for _, c := range []glazed.Command{newPush(), newPull()} {
		cmd, err := cli.BuildCobraCommandFromCommand(c)
		if err != nil {
			return err
		}
		root.AddCommand(cmd)
	}
	groups := []struct {
		use, short string
		cmds       []glazed.Command
	}{
		{"artifacts", "List artifacts", []glazed.Command{&artifactsCmd{glazed.NewCommandDescription("list", glazed.WithShort("List artifacts"),
			glazed.WithFlags(append(serverFlags(), fields.New("project", fields.TypeString, fields.WithShortFlag("p"), fields.WithHelp("Only this project")))...))}}},
		{"route", "Point site paths at page versions, with history and undo", routeCommands()},
		{"comments", "Wait for, list and answer comments", commentCommands()},
		{"projects", "List and edit projects", projectCommands()},
		{"dev", "Development helpers", []glazed.Command{newDevSeed()}},
	}
	for _, g := range groups {
		cmd, err := group(g.use, g.short, g.cmds...)
		if err != nil {
			return err
		}
		root.AddCommand(cmd)
	}
	return nil
}
