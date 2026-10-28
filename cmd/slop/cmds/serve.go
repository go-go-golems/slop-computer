package cmds

import (
	"context"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	glazed "github.com/go-go-golems/glazed/pkg/cmds"
	"github.com/go-go-golems/glazed/pkg/cmds/values"
	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/server"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"golang.org/x/sync/errgroup"
)

type serveCmd struct{ *glazed.CommandDescription }

var _ glazed.BareCommand = (*serveCmd)(nil)

func newServe() *serveCmd {
	return &serveCmd{glazed.NewCommandDescription("serve",
		glazed.WithShort("Run the slop.computer server"),
		glazed.WithLong("With --local: SQLite in ./var, nickname sign-in instead of OIDC, loopback only. "+
			"Every default --local sets can still be overridden by its flag."),
		glazed.WithFlags(
			boolean("local", "Local mode: SQLite, nickname sign-in, no authentication; loopback only"),
			flagDefault("local-role", "admin", "Local mode: role of a nickname on first sign-in (admin or pending)"),
			flag("database-url", "sqlite:<path> or postgres://… (default with --local: sqlite:./var/slop.db)"),
			flag("database-url-file", "File containing the database URL"),
			flagDefault("blobs", "./var/blobs", "Directory for file contents (sha256-addressed)"),
			flag("listen", "Listen address (default 127.0.0.1:8080)"),
			flag("public-url", "Main host origin, e.g. https://slop.computer (default with --local: http://localhost:<port>)"),
			list("dev-origin", "Further origins that reach the main host, e.g. http://localhost:5173 for the Vite dev server"),
			flag("oidc-issuer", "OIDC issuer URL (ZITADEL)"),
			flag("oidc-client-id", "OIDC client ID"),
			flag("oidc-client-secret-file", "File containing the OIDC client secret (empty for a PKCE public client)"),
			list("oidc-scope", "Extra OIDC scopes"),
			boolean("no-migrate", "Do not apply pending migrations at start"),
			boolean("trust-proxy-headers", "Take the client address from X-Real-Ip / X-Forwarded-For"),
		))}
}

func readSecret(path string) (string, error) {
	if path == "" {
		return "", nil
	}
	b, err := os.ReadFile(path) // #nosec G304 -- operator-supplied secret file
	if err != nil {
		return "", errors.Wrap(err, "read "+path)
	}
	return strings.TrimSpace(string(b)), nil
}

// openStore opens and optionally migrates the database.
func openStore(ctx context.Context, dbURL string, migrate bool) (*store.Store, error) {
	st, err := store.Open(ctx, dbURL)
	if err != nil {
		return nil, err
	}
	if migrate {
		applied, err := st.Migrate(ctx)
		if err != nil {
			_ = st.Close()
			return nil, err
		}
		for _, a := range applied {
			log.Info().Str("migration", a).Msg("Applied migration")
		}
	}
	pending, err := st.Pending(ctx)
	if err != nil {
		_ = st.Close()
		return nil, err
	}
	if len(pending) > 0 {
		_ = st.Close()
		return nil, errors.Errorf("pending migrations %v; run slop migrate", pending)
	}
	return st, nil
}

func (c *serveCmd) Run(ctx context.Context, v *values.Values) error {
	a := in{v}
	local := a.B("local")
	listen := a.S("listen")
	if listen == "" {
		listen = "127.0.0.1:8080"
	}
	_, port, err := net.SplitHostPort(listen)
	if err != nil {
		return errors.Wrap(err, "listen")
	}
	dbURL, err := readSecret(a.S("database-url-file"))
	if err != nil {
		return err
	}
	if dbURL == "" {
		dbURL = a.S("database-url")
	}
	publicURL := a.S("public-url")
	extra := a.L("dev-origin")
	cfg := server.Config{TrustProxyHeaders: a.B("trust-proxy-headers")}
	if local {
		if dbURL == "" {
			dbURL = "sqlite:./var/slop.db"
		}
		if publicURL == "" {
			publicURL = "http://localhost:" + port
		}
		cfg.Local = &server.LocalConfig{Role: a.S("local-role")}
	}
	if dbURL == "" {
		return errors.New("--database-url is required (or use --local)")
	}
	if cfg.PublicURL, err = url.Parse(strings.TrimRight(publicURL, "/")); err != nil || publicURL == "" {
		return errors.New("--public-url must be an origin such as https://slop.computer")
	}
	if local {
		// The other loopback spelling gets its own cookie, so one browser can
		// hold two identities side by side.
		switch cfg.PublicURL.Hostname() {
		case "localhost":
			extra = append(extra, "http://127.0.0.1:"+cfg.PublicURL.Port())
		case "127.0.0.1":
			extra = append(extra, "http://localhost:"+cfg.PublicURL.Port())
		}
	}
	cfg.ExtraOrigins = extra
	if !local {
		secret, err := readSecret(a.S("oidc-client-secret-file"))
		if err != nil {
			return err
		}
		if err = identity.ValidateScopes(a.L("oidc-scope")); err != nil {
			return err
		}
		cfg.OIDC = identity.New(identity.Config{Issuer: a.S("oidc-issuer"), ClientID: a.S("oidc-client-id"), ClientSecret: secret,
			RedirectURL: strings.TrimRight(publicURL, "/") + "/auth/callback", ExtraScopes: a.L("oidc-scope")})
	}
	if err = cfg.Validate(listen); err != nil {
		return err
	}
	st, err := openStore(ctx, dbURL, !a.B("no-migrate"))
	if err != nil {
		return err
	}
	defer func() { _ = st.Close() }()

	bl, err := blobs.Open(a.S("blobs"))
	if err != nil {
		return err
	}
	srv := server.New(cfg, st, bl)
	hs := &http.Server{Addr: listen, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	if local {
		log.Warn().Msg("LOCAL MODE: no authentication; listening on loopback only")
	}
	log.Info().Str("listen", listen).Str("public", publicURL).Str("database", store.Redact(dbURL)).Msg("slop serving")
	g, gctx := errgroup.WithContext(ctx)
	g.Go(func() error {
		if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	})
	g.Go(func() error {
		<-gctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return hs.Shutdown(sctx)
	})
	return g.Wait()
}
