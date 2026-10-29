// Command slop is the slop.computer server and the CLI agents use to push
// artifacts, set routes and wait for comments.
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/go-go-golems/glazed/pkg/cmds/logging"
	"github.com/go-go-golems/glazed/pkg/help"
	help_cmd "github.com/go-go-golems/glazed/pkg/help/cmd"
	"github.com/go-go-golems/slop-computer/cmd/slop/cmds"
	"github.com/go-go-golems/slop-computer/pkg/doc"
	"github.com/pkg/errors"
	"github.com/spf13/cobra"
)

func run(ctx context.Context) error {
	root := &cobra.Command{
		Use: "slop", Short: "slop.computer: a workshop for two people and their agents",
		Version: "dev", SilenceUsage: true, SilenceErrors: true,
		PersistentPreRunE: func(cmd *cobra.Command, _ []string) error {
			return logging.InitLoggerFromCobra(cmd)
		},
	}
	if err := logging.AddLoggingSectionToRootCommand(root, "slop"); err != nil {
		return errors.Wrap(err, "configure logging")
	}
	hs := help.NewHelpSystem()
	if err := doc.AddDocToHelpSystem(hs); err != nil {
		return errors.Wrap(err, "load help topics")
	}
	help_cmd.SetupCobraRootCommand(hs, root)
	if err := cmds.Register(root); err != nil {
		return errors.Wrap(err, "register commands")
	}
	return root.ExecuteContext(ctx)
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		_, _ = fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
