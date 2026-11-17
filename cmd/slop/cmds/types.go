package cmds

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// typesCmd is slop types: an app's TypeScript declarations, from the
// server, into the app's folder (SLOP3-024, design §5.5).
func typesCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "types <app> [dir]",
		Short: "Write an app's TypeScript declarations into <dir>/" + client.TypesDir + " (and its tsconfig files, when missing)",
		Long: "Writes page.d.ts (window.claude), actor.d.ts (the actor runtime) and modules.d.ts (the Go modules the app may use on this server) into <dir>/" + client.TypesDir + ",\n" +
			"and tsconfig.json (the pages) and tsconfig.actor.json (the actor) when they do not exist yet. Then tsc -p tsconfig.json and\n" +
			"tsc -p tsconfig.actor.json check the app. " + client.TypesDir + " is never pushed; slop dev refreshes it when it starts.",
		Args: cobra.RangeArgs(1, 2),
		RunE: func(cmd *cobra.Command, args []string) error {
			dir := "."
			if len(args) == 2 {
				dir = args[1]
			}
			c, err := resolve()
			if err != nil {
				return err
			}
			wrote, err := c.Types(args[0], dir, true)
			for _, p := range wrote {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "wrote", p)
			}
			return err
		},
	}
}
