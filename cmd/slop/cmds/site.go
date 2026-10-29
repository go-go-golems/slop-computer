package cmds

import (
	"context"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
)

// The site index: every public URL of a site host, as a page reading
// "$site" gets it. See `slop help pinup` (Pinup apps) and `slop help agents`.

type siteListCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*siteListCmd)(nil)

func (c *siteListCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	rows, err := api.SiteIndex(ctx, a.S("host"))
	if err != nil {
		return loginHint(err)
	}
	for _, r := range rows {
		if err := out.AddRow(ctx, types.NewRow(types.MRP("path", r["path"]), types.MRP("kind", r["kind"]), types.MRP("title", r["title"]),
			types.MRP("page", r["page"]), types.MRP("route", r["route"]), types.MRP("section", r["section"]), types.MRP("updated", r["updated"]))); err != nil {
			return err
		}
	}
	return nil
}

func siteCommands() []glazed.Command {
	return []glazed.Command{
		&siteListCmd{glazed.NewCommandDescription("ls", glazed.WithShort("List every public URL of a site host (what pages read as $site)"),
			glazed.WithLong("Static routes, each listed record a record route serves, and each page a page-from route admits.\nUnlisted: private routes, the fallback, :param routes without a record, pages with \"listed\": false,\nand records marked draft, hidden, listed: false or with a visibility other than public.\n\nExamples:\n  slop site ls\n  slop site ls --host site.example.com --output json"),
			glazed.WithFlags(append(serverFlags(), flag("host", "Site host (default: the first site host)"))...))},
	}
}
