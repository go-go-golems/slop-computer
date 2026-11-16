package cmds

import (
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// devCmd is `slop dev <dir> --app <id>` (SLOP3-022 C.5).
func devCmd() *cobra.Command {
	var app, instance string
	var every time.Duration
	var once bool
	cmd := &cobra.Command{
		Use:   "dev <dir>",
		Short: "Push a folder to an app's draft on every change, and run it in your dev instance",
		Long: `Push <dir> to the app's draft ref now and whenever a file changes, and
bring your dev instance of the app (<app>-dev-<you>, made on first use, with
its own data) up on each new snapshot. Each push prints where the instance
is, or why it broke (a failed migration, a setup that threw); the
instance's new log lines follow. Production keeps running main. Publish a
draft with: slop ref move <app> main <n> --ifAt <main's n>.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := resolve()
			if err != nil {
				return err
			}
			if app == "" {
				abs, _ := filepath.Abs(args[0])
				app = filepath.Base(abs)
			}
			ctx, stop := signal.NotifyContext(cmd.Context(), syscall.SIGINT, syscall.SIGTERM)
			defer stop()
			return c.Dev(ctx, args[0], client.DevOptions{App: app, Instance: instance, Every: every, Once: once, Out: cmd.OutOrStdout()})
		},
	}
	cmd.Flags().StringVar(&app, "app", "", "the app store (default: the folder's name)")
	cmd.Flags().StringVar(&instance, "instance", "", "the dev instance (default <app>-dev-<you>)")
	cmd.Flags().DurationVar(&every, "every", 500*time.Millisecond, "how often the folder is looked at")
	cmd.Flags().BoolVar(&once, "once", false, "push once, report and exit")
	return cmd
}
