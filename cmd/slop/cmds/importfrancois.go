package cmds

import (
	"context"
	"fmt"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/fields"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/glazed/pkg/middlewares"
	"github.com/go-go-golems/glazed/pkg/types"
	"github.com/go-go-golems/slop-computer/pkg/francois"
	"github.com/go-go-golems/slop-computer/pkg/seed"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// Importing a francois catalog (SLOP-002): extract a seed directory and a
// census from a restored database or the studio API, then push it.

func francoisFlags() []*fields.Definition {
	return []*fields.Definition{
		flag("francois-db", "Restored francois database URL (postgres://…); read-only session"),
		flag("francois-db-file", "File containing the francois database URL"),
		flag("francois-blobs", "Restored francois blob directory (the one holding blobs/, /var/lib/francois/releases in production)"),
		flag("francois-server", "francois server for the studio API (default: the francois CLI's default login)"),
		flag("francois-token-file", "File containing a francois API token (default: the francois CLI's stored token)"),
	}
}

// francoisSource opens the database source when a database is named,
// otherwise the studio API.
func francoisSource(ctx context.Context, a in) (francois.Source, error) {
	dsn, err := readSecret(a.S("francois-db-file"))
	if err != nil {
		return nil, err
	}
	if dsn = firstNonEmpty(dsn, a.S("francois-db")); dsn != "" {
		return francois.OpenDB(ctx, dsn, a.S("francois-blobs"))
	}
	server, token := a.S("francois-server"), ""
	if f := a.S("francois-token-file"); f != "" {
		if token, err = readSecret(f); err != nil {
			return nil, err
		}
		if server == "" {
			return nil, errors.New("--francois-token-file needs --francois-server")
		}
	} else if server, token, err = francois.StoredToken(server); err != nil {
		return nil, err
	}
	return francois.NewAPI(server, token), nil
}

type importExtractCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*importExtractCmd)(nil)

func newImportExtract() *importExtractCmd {
	return &importExtractCmd{glazed.NewCommandDescription("extract",
		glazed.WithShort("Read a francois catalog into a seed directory and a capability census"),
		glazed.WithLong("Reads francois's catalog artifacts, releases, storefront pages, posts, creators and media, from a restored "+
			"database and blob directory (--francois-db, --francois-blobs) or from the studio API with the francois CLI's token, and writes "+
			"a seed directory: releases become versions of page artifacts, the storefront becomes the data artifacts francois-catalog, "+
			"francois-journal, francois-creators and francois-media. census.md says what the content needs that slop lacks. "+
			"Only reads francois. Push the result with: slop import francois push --dir <out>"),
		glazed.WithFlags(append(francoisFlags(),
			fields.New("out", fields.TypeString, fields.WithRequired(true), fields.WithHelp("New directory for the seed and census")),
			boolean("all-media", "Copy the whole media library, not only referenced media"),
		)...))}
}

func (c *importExtractCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	src, err := francoisSource(ctx, a)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	snap, err := src.Snapshot(ctx)
	if err != nil {
		return err
	}
	fmt.Printf("read %d artifacts, %d posts, %d creators, %d media from %s\n", len(snap.Artifacts), len(snap.Posts), len(snap.Creators), len(snap.Media), snap.Source)
	census, err := francois.Extract(ctx, src, snap, a.S("out"), francois.Options{AllMedia: a.B("all-media"),
		Log: func(format string, args ...any) { fmt.Printf(format, args...) }})
	if err != nil {
		return err
	}
	fmt.Printf("wrote %s: %d releases (%d with their HTML), %d media; see census.md\n", a.S("out"), census.Releases, census.HTMLOriginal, census.Media.Copied)
	return nil
}

type importPushCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*importPushCmd)(nil)

func newImportPush() *importPushCmd {
	return &importPushCmd{glazed.NewCommandDescription("push",
		glazed.WithShort("Push an extracted francois seed directory"),
		glazed.WithLong("Pushes what extract wrote, data first. Re-running pushes only releases not imported yet (matched by release ID) "+
			"and data that changed. Releases are authored by their francois author when that person has a slop account and the token "+
			"has the admin scope, otherwise by you. Draft and withdrawn releases do not become main."),
		glazed.WithFlags(append(serverFlags(),
			fields.New("dir", fields.TypeString, fields.WithRequired(true), fields.WithHelp("Directory written by slop import francois extract")),
		)...))}
}

func (c *importPushCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	api, err := apiClient(ctx, a)
	if err != nil {
		return err
	}
	f, err := seed.Load(a.S("dir"))
	if err != nil {
		return err
	}
	res, err := seed.Push(ctx, a.S("dir"), f, seed.Options{Admin: api, Log: func(format string, args ...any) { fmt.Printf(format, args...) }})
	if err != nil {
		return err
	}
	fmt.Printf("pushed %d versions; %d unchanged, %d already imported\n", res.Versions, res.Unchanged, res.Skipped)
	return nil
}

// importAdminsCmd makes francois's admins slop admins, by OIDC identity.
type importAdminsCmd struct{ *glazed.CommandDescription }

var _ glazed.GlazeCommand = (*importAdminsCmd)(nil)

func newImportAdmins() *importAdminsCmd {
	return &importAdminsCmd{glazed.NewCommandDescription("import-francois-admins",
		glazed.WithShort("Make francois's admins slop admins (same identity provider)"),
		glazed.WithLong("Reads francois's enabled admins (database or studio API with admin:read) and, matching on OIDC issuer and "+
			"subject, creates them as slop admins or promotes their pending accounts. Everyone else stays pending. "+
			"Only useful when both apps sign in through the same ZITADEL instance."),
		dbFlags(append(francoisFlags(), boolean("dry-run", "Only list who would be imported"))...))}
}

func (c *importAdminsCmd) RunIntoGlazeProcessor(ctx context.Context, v *values.Values, out middlewares.Processor) error {
	a := in{v}
	src, err := francoisSource(ctx, a)
	if err != nil {
		return err
	}
	defer func() { _ = src.Close() }()
	snap, err := src.Snapshot(ctx)
	if err != nil {
		return err
	}
	var admins []francois.User
	for _, u := range snap.Users {
		if u.Role == "admin" && !u.Disabled {
			admins = append(admins, u)
		}
	}
	if len(admins) == 0 {
		return errors.New("francois reported no admins (the API needs a token with admin:read)")
	}
	var st *store.Store
	if !a.B("dry-run") {
		u, err := dbURL(a)
		if err != nil {
			return err
		}
		if st, err = openStore(ctx, u, false); err != nil {
			return err
		}
		defer func() { _ = st.Close() }()
	}
	actx := store.WithAuditVia(ctx, "slop db import-francois-admins")
	for _, fu := range admins {
		id, action := "", "would import"
		if st != nil {
			u, act, err := st.ImportAdmin(ctx, store.Identity{Issuer: fu.Issuer, Subject: fu.Subject, Email: fu.Email, Name: fu.Name, EmailVerified: fu.EmailVerified})
			if err != nil {
				return errors.Wrap(err, fu.Email)
			}
			id, action = u.ID, act
			if act == "created" || act == "promoted" {
				_ = st.Audit(actx, "", "user.import", u.ID, map[string]any{"from": "francois", "francoisId": fu.ID, "action": act})
			}
		}
		if err := out.AddRow(ctx, types.NewRow(types.MRP("id", id), types.MRP("name", fu.Name), types.MRP("email", fu.Email),
			types.MRP("issuer", fu.Issuer), types.MRP("subject", fu.Subject), types.MRP("action", action))); err != nil {
			return err
		}
	}
	return nil
}
