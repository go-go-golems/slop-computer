package cmds

import (
	"fmt"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// typesCmd is slop types: an app's TypeScript declarations, from the
// server, into the app's folder (SLOP3-024, design §5.5).
func typesCmd() *cobra.Command {
	var instance string
	cmd := &cobra.Command{
		Use:   "types <app> [dir]",
		Short: "Write an app's TypeScript declarations into <dir>/" + client.TypesDir + " (and its tsconfig files, when missing)",
		Long: "Writes page.d.ts (window.claude), actor.d.ts (the actor runtime) and modules.d.ts (the Go modules the app may use on this server) into <dir>/" + client.TypesDir + ",\n" +
			"and tsconfig.json (the pages) and tsconfig.actor.json (the actor) when they do not exist yet. Then tsc -p tsconfig.json and\n" +
			"tsc -p tsconfig.actor.json check the app. actions.d.ts declares the actions of a running actor: your dev instance's\n" +
			"(which runs draft) when you have one, else the app store's (--instance names another). " + client.TypesDir + " is never pushed;\n" +
			"slop dev refreshes it when it starts.",
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
			if instance == "" {
				instance = c.DevInstance(args[0])
			}
			wrote, err := c.Types(args[0], dir, true, instance)
			for _, p := range wrote {
				_, _ = fmt.Fprintln(cmd.OutOrStdout(), "wrote", p)
			}
			return err
		},
	}
	cmd.Flags().StringVar(&instance, "instance", "", "the store whose actor's actions to declare (default: your dev instance, else the app store)")
	return cmd
}
