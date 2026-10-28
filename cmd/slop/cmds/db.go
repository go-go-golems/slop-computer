package cmds

import (
	"context"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// Operator commands that talk to the database directly: bootstrap and
// break-glass. Everything else goes through the API.

func dbFlags(extra ...*fields.Definition) glazed.CommandDescriptionOption {
	return glazed.WithFlags(append([]*fields.Definition{
		flag("database-url", "sqlite:<path> or postgres://… (default: sqlite:./var/slop.db)"),
		flag("database-url-file", "File containing the database URL"),
	}, extra...)...)
}

func dbURL(a in) (string, error) {
	u, err := readSecret(a.S("database-url-file"))
	if err != nil || u != "" {
		return u, err
	}
	if u = a.S("database-url"); u != "" {
		return u, nil
	}
	return "sqlite:./var/slop.db", nil
}

type migrateCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*migrateCmd)(nil)

func (c *migrateCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	u, err := dbURL(in{v})
	if err != nil {
		return err
	}
	st, err := store.Open(ctx, u)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	applied, err := st.Migrate(ctx)
	if err != nil {
		return err
	}
	for _, m := range applied {
		if err = out.AddRow(ctx, types.NewRow(types.MRP("applied", m))); err != nil {
			return err
		}
	}
	return nil
}

type usersCmd struct {
	*glazed.CommandDescription
	action string
}

var _ glazed.GlazeCommand = (*usersCmd)(nil)

func (c *usersCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	u, err := dbURL(a)
	if err != nil {
		return err
	}
	st, err := openStore(ctx, u, false)
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()
	var users []store.User
	switch c.action {
	case "list":
		if users, err = st.Users(ctx); err != nil {
			return err
		}
	case "promote", "disable", "pending":
		role := map[string]string{"promote": store.RoleAdmin, "disable": store.RoleDisabled, "pending": store.RolePending}[c.action]
		target, err := findUser(ctx, st, a)
		if err != nil {
			return err
		}
		if target, err = st.SetUserRole(ctx, target.ID, role); err != nil {
			return err
		}
		_ = st.Audit(store.WithAuditVia(ctx, "slop db"), "", "user.role", target.ID, map[string]any{"to": role})
		users = []store.User{target}
	}
	for _, u := range users {
		if err := out.AddRow(ctx, types.NewRow(types.MRP("id", u.ID), types.MRP("name", u.DisplayName), types.MRP("email", u.Email),
			types.MRP("role", u.Role), types.MRP("issuer", u.Issuer), types.MRP("subject", u.Subject))); err != nil {
			return err
		}
	}
	return nil
}

func findUser(ctx context.Context, st *store.Store, a in) (store.User, error) {
	if id := a.S("user-id"); id != "" {
		return st.User(ctx, id)
	}
	if a.S("issuer") == "" || a.S("subject") == "" {
		return store.User{}, errors.New("give --user-id, or --issuer and --subject (local nicknames: --issuer local --subject <nickname>)")
	}
	u, err := st.UserByIdentity(ctx, a.S("issuer"), a.S("subject"))
	if errors.Is(err, store.ErrNotFound) {
		return u, errors.New("no such user yet: they have to sign in once first")
	}
	return u, err
}

func dbCommands() ([]glazed.Command, []glazed.Command) {
	who := []*fields.Definition{flag("user-id", "User ID (usr_…)"), flag("issuer", "Identity issuer"), flag("subject", "Identity subject")}
	top := []glazed.Command{&migrateCmd{glazed.NewCommandDescription("migrate", glazed.WithShort("Apply pending database migrations"), dbFlags())}}
	users := []glazed.Command{
		&usersCmd{glazed.NewCommandDescription("list", glazed.WithShort("List users"), dbFlags()), "list"},
		&usersCmd{glazed.NewCommandDescription("promote", glazed.WithShort("Make a user an admin (bootstraps the first admin)"), dbFlags(who...)), "promote"},
		&usersCmd{glazed.NewCommandDescription("disable", glazed.WithShort("Disable a user and revoke their sessions and tokens"), dbFlags(who...)), "disable"},
		&usersCmd{glazed.NewCommandDescription("pending", glazed.WithShort("Set a user back to pending"), dbFlags(who...)), "pending"},
	}
	return top, users
}
