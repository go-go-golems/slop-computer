package cmds

import "github.com/spf13/cobra"

// addExtraCommands adds the local commands that are not verbs (push, pull,
// eval, import, app new, lint). Later phases fill this in.
func addExtraCommands(root *cobra.Command) {}
