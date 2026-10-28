package cmds

import (
	"context"
	"fmt"
	"os"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/slop-computer/pkg/client"
	"github.com/go-go-golems/slop-computer/pkg/seed"
	"github.com/pkg/errors"
)

type devSeedCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*devSeedCmd)(nil)

func newDevSeed() *devSeedCmd {
	return &devSeedCmd{glazed.NewCommandDescription("seed",
		glazed.WithShort("Push the Workshop prototype's demo content through the API"),
		glazed.WithLong("Reads examples/seed (see scripts/export-seed.mjs): projects, 14 artifacts with their version histories, "+
			"routes for the site host and comment threads. Against a local-mode server each version and comment is made by its original "+
			"author (manuel, ramon); otherwise everything is made by the logged-in user."),
		glazed.WithFlags(append(serverFlags(),
			flagDefault("dir", "examples/seed", "Exported seed directory"),
			flag("host", "Site host for the routes (default: the server's first site host)"),
		)...))}
}

func (c *devSeedCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		// A local server needs no stored login: --as tokens are minted below.
		srv := firstNonEmpty(a.S("server"), os.Getenv("SLOP_SERVER"))
		if srv == "" {
			return err
		}
		api = client.New(srv, "")
	}
	dir := a.S("dir")
	f, err := seed.Load(dir)
	if err != nil {
		return err
	}
	cfg, err := api.Config(ctx)
	if err != nil {
		return err
	}
	// as returns the client acting as a seed author.
	authors := map[string]*client.Client{}
	as := func(nick string) (*client.Client, error) {
		if cfg.Mode != "local" {
			return api, nil
		}
		if c, ok := authors[nick]; ok {
			return c, nil
		}
		tok, err := client.New(api.Server(), "").LocalToken(ctx, nick, "dev seed", []string{"read", "write"}, 1)
		if err != nil {
			return nil, errors.Wrap(err, "local token for "+nick)
		}
		authors[nick] = client.New(api.Server(), tok.Token)
		return authors[nick], nil
	}
	admin, err := as("manuel")
	if err != nil {
		return err
	}
	host := a.S("host")
	if host == "" && len(cfg.SiteHosts) > 0 {
		host = cfg.SiteHosts[0]
	}
	res, err := seed.Push(ctx, dir, f, seed.Options{Admin: admin, As: as, SkipExisting: true, Host: host, Note: "dev seed",
		Log: func(format string, args ...any) { fmt.Printf(format, args...) }})
	if err != nil {
		return err
	}
	fmt.Printf("seeded %d versions, %d routes on %s, %d threads\n", res.Versions, res.Routes, host, res.Threads)
	return nil
}
