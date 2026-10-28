// Package cmds contains the slop CLI's Glazed commands.
package cmds

import (
	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cli"
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
	return nil
}
