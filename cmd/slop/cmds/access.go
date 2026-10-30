package cmds

import (
	"context"
	"fmt"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
)

// slop access: who may open a target (an app's data, or an app on itself)
// on live routes, and who has it open now (SLOP-011).

type accessListCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*accessListCmd)(nil)

func (c *accessListCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	acc, err := api.Access(ctx, a.S("target"))
	if err != nil {
		return loginHint(err)
	}
	row := func(kind, who, name, level, detail string) error {
		return out.AddRow(ctx, types.NewRow(types.MRP("kind", kind), types.MRP("who", who), types.MRP("name", name), types.MRP("level", level), types.MRP("detail", detail)))
	}
	if acc.Owner != nil {
		if err := row("owner", acc.Owner.ID, acc.Owner.Name, "owner", "created it"); err != nil {
			return err
		}
	}
	for _, g := range acc.Grants {
		detail := "granted " + g.CreatedAt.Format("2006-01-02")
		if g.Via != "" {
			detail = "by share link " + g.Via
		}
		if err := row("grant", g.Subject, g.Name, g.Level, detail); err != nil {
			return err
		}
	}
	for _, l := range acc.Links {
		state := "active"
		if l.Revoked {
			state = "revoked"
		}
		if err := row("link", l.ID, "", l.Level, state); err != nil {
			return err
		}
	}
	for _, vw := range acc.Views {
		if err := row("open", vw.Principal, vw.Name, vw.Level, vw.Kind+" since "+vw.Since.Format("15:04")); err != nil {
			return err
		}
	}
	for _, r := range acc.Routes {
		if err := row("route", r.Host+r.Path, "", "", "live, for "+r.Access); err != nil {
			return err
		}
	}
	return nil
}

type accessGrantCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*accessGrantCmd)(nil)

func (c *accessGrantCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	if err := api.Grant(ctx, a.S("target"), a.S("subject"), a.S("level")); err != nil {
		return loginHint(err)
	}
	fmt.Printf("%s: %s may %s (open views of it were renewed at their new level)\n", a.S("target"), a.S("subject"), a.S("level"))
	return nil
}

type accessRevokeCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*accessRevokeCmd)(nil)

func (c *accessRevokeCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	if err := api.Revoke(ctx, a.S("target"), a.S("subject")); err != nil {
		return loginHint(err)
	}
	fmt.Printf("%s: %s's grant is gone (their open views were closed)\n", a.S("target"), a.S("subject"))
	return nil
}

func accessCommands() []glazed.Command {
	target := arg("target", "The target: an app's data artifact, or an app opened on itself")
	return []glazed.Command{
		&accessListCmd{glazed.NewCommandDescription("ls", glazed.WithShort("Who may open a target, and who has it open now"),
			glazed.WithFlags(append(serverFlags(), target)...))},
		&accessGrantCmd{glazed.NewCommandDescription("grant", glazed.WithShort("Give a subject a level on a target"),
			glazed.WithLong("Subjects: a person's id (usr_…, see slop users), *signed-in (members and admins) or *anyone.\n"+
				"Levels: view, interact, admin, owner. Members never get more than admin; models and publishing stay with admins.\n\n"+
				"Examples:\n  slop access grant ws-team '*signed-in' view\n  slop access grant ws-team usr_02657c47 interact\n"),
			glazed.WithFlags(append(serverFlags(), target, arg("subject", "usr_…, *signed-in or *anyone"), arg("level", "view, interact, admin or owner"))...))},
		&accessRevokeCmd{glazed.NewCommandDescription("revoke", glazed.WithShort("Take a subject's grant on a target away"),
			glazed.WithFlags(append(serverFlags(), target, arg("subject", "usr_…, *signed-in or *anyone"))...))},
	}
}
