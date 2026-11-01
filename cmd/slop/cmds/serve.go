package cmds

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/spf13/cobra"

	"github.com/go-go-golems/slop/pkg/actor"
	"github.com/go-go-golems/slop/pkg/config"
	"github.com/go-go-golems/slop/pkg/kernel"
	"github.com/go-go-golems/slop/pkg/server"
	"github.com/go-go-golems/slop/pkg/system"
	"github.com/go-go-golems/slop/pkg/verbs"
)

func serveCmd() *cobra.Command {
	var cfgPath, listen, data string
	var local, test bool
	var admins []string
	cmd := &cobra.Command{
		Use:   "serve",
		Short: "Run the slop server",
		RunE: func(cmd *cobra.Command, args []string) error {
			cfg, err := config.Load(cfgPath)
			if err != nil {
				return err
			}
			if listen != "" {
				cfg.Listen = listen
				cfg.Hosts = config.Hosts{} // re-derive *.localhost hosts for the new port
				if cfgPath != "" {
					c2, _ := config.Load(cfgPath)
					cfg.Hosts = c2.Hosts
				}
			}
			if data != "" {
				cfg.Data = data
			}
			cfg.Local = cfg.Local || local
			cfg.Test = cfg.Test || test
			cfg.AdminEmails = append(cfg.AdminEmails, admins...)
			cfg.Defaults()
			return runServer(cmd.Context(), cfg)
		},
	}
	cmd.Flags().StringVar(&cfgPath, "config", "", "slop.yaml")
	cmd.Flags().StringVar(&listen, "listen", "", "address to listen on (default 127.0.0.1:18300)")
	cmd.Flags().StringVar(&data, "data", "", "data directory (default ./data)")
	cmd.Flags().BoolVar(&local, "local", false, "local sign-in form instead of OIDC (development)")
	cmd.Flags().BoolVar(&test, "test", false, "test mode: loopback only, X-Slop-As, fake LLM")
	cmd.Flags().StringArrayVar(&admins, "admin-email", nil, "an email that becomes admin when it signs in (repeatable)")
	return cmd
}

func runServer(parent context.Context, cfg *config.Config) error {
	if parent == nil {
		parent = context.Background()
	}
	ctx, stop := signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := os.MkdirAll(cfg.Data, 0o755); err != nil {
		return err
	}
	sys, err := system.Open(ctx, filepath.Join(cfg.Data, "system.db"))
	if err != nil {
		return err
	}
	defer sys.Close()
	k, err := kernel.New(cfg, sys)
	if err != nil {
		return err
	}
	defer k.Close()
	env := &verbs.Env{Cfg: cfg, Sys: sys, K: k, A: actor.New(k)}
	srv, err := server.Build(ctx, cfg, sys, env)
	if err != nil {
		return err
	}
	fmt.Fprintf(os.Stderr, "slop serving on %s\n  main    %s\n  live    %v\n  static  %v\n  sandbox *.%s\n",
		cfg.Listen, cfg.MainURL(), cfg.Hosts.Live, cfg.Hosts.Static, cfg.Hosts.Sandbox)
	return srv.ListenAndServe(ctx)
}
