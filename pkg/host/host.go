// Package host assembles slop (SLOP3-010 PR 3): it builds the verb table,
// installs the commands, makes every door, and dispatches each request on
// its Host header to the main host (back office, sign-in, /api/v1, /mcp),
// live hosts, static hosts and sandbox origins. It is the one place besides
// cmd/ that imports pkg/commands.
package host

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/billing"
	"github.com/go-go-golems/slop-computer/pkg/billing/stripe"
	"github.com/go-go-golems/slop-computer/pkg/commands"
	"github.com/go-go-golems/slop-computer/pkg/config"
	actorsdoor "github.com/go-go-golems/slop-computer/pkg/doors/actors"
	apidoor "github.com/go-go-golems/slop-computer/pkg/doors/api"
	authdoor "github.com/go-go-golems/slop-computer/pkg/doors/auth"
	billingdoor "github.com/go-go-golems/slop-computer/pkg/doors/billing"
	mcpdoor "github.com/go-go-golems/slop-computer/pkg/doors/mcp"
	officedoor "github.com/go-go-golems/slop-computer/pkg/doors/office"
	"github.com/go-go-golems/slop-computer/pkg/doors/pages"
	"github.com/go-go-golems/slop-computer/pkg/doors/web"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/ids"
	"github.com/go-go-golems/slop-computer/pkg/llm"
	"github.com/go-go-golems/slop-computer/pkg/llm/gepp"
	"github.com/go-go-golems/slop-computer/pkg/policy"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// Server holds the doors and what they share.
type Server struct {
	Cfg *config.Config
	Sys *sysdb.DB
	// system.db's domains: the kernel's, or built over Sys without one.
	People   *identity.Accounts
	Registry *registry.Registry
	Ledger   *llm.Ledger
	Gov      *policy.Governance
	Book     *billing.Book
	Env      *commands.Env
	// Verbs is the table every door calls (the commands installed with Env).
	Verbs *verbs.Table
	// Pages is the page door (live, static and sandbox hosts).
	Pages *pages.Door
	// Host handlers for live, static and sandbox hosts (the page door's).
	Live, Static, Sandbox http.Handler

	main *http.ServeMux
	// web resolves requests to principals (pkg/doors/web).
	web *web.Sessions
	// auth is the sign-in door (pkg/doors/auth).
	auth *authdoor.Door
	// billingDoor is the subscription door (pkg/doors/billing).
	billingDoor *billingdoor.Door
	billing     *stripe.Service
}

// Build makes the server with everything the configuration enables.
func Build(ctx context.Context, cfg *config.Config, sys *sysdb.DB, env *commands.Env) (*Server, error) {
	s := New(cfg, sys, env)
	if err := s.auth.Setup(); err != nil {
		return nil, err
	}
	if err := s.setupBilling(); err != nil {
		return nil, err
	}
	if err := s.setupLLM(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

// setupLLM starts the model backend the config names.
func (s *Server) setupLLM(ctx context.Context) error {
	if s.Env.A == nil {
		return nil
	}
	switch s.Cfg.LLM {
	case "":
		return nil
	case "fake":
		s.Env.A.LLM = &llm.Fake{}
	case "pi":
		agent := s.Cfg.Pi.AgentDir
		if agent == "" {
			home, _ := os.UserHomeDir()
			agent = filepath.Join(home, ".pi", "agent")
		}
		b, err := gepp.New(gepp.Config{AgentDir: agent, Tiers: s.Cfg.Pi.Models})
		if err != nil {
			return fmt.Errorf("load Pi's models from %s: %w", agent, err)
		}
		log.Printf("Pi models ready (Geppetto): %d", len(b.Models()))
		s.Env.A.LLM = b
	default:
		return fmt.Errorf("unknown llm %q (pi or fake)", s.Cfg.LLM)
	}
	return nil
}

// New builds a server.
func New(cfg *config.Config, sys *sysdb.DB, env *commands.Env) *Server {
	s := &Server{Cfg: cfg, Sys: sys, Env: env, main: http.NewServeMux(), Verbs: verbs.NewTable()}
	if env != nil && env.K != nil {
		s.People, s.Registry, s.Ledger, s.Gov, s.Book = env.K.People, env.K.Registry, env.K.Ledger, env.K.Gov, env.K.Book
	} else if sys != nil {
		s.People, s.Registry, s.Ledger, s.Gov, s.Book = identity.NewAccounts(sys), registry.NewRegistry(sys), llm.NewLedger(sys), policy.NewGovernance(sys), billing.NewBook(sys)
	}
	s.web = &web.Sessions{Cfg: cfg, People: s.People}
	s.auth = &authdoor.Door{Cfg: cfg, Web: s.web, People: s.People}
	s.billingDoor = &billingdoor.Door{Cfg: cfg, Web: s.web, Book: s.Book}
	if env != nil {
		s.billingDoor.K = env.K
	}
	if env != nil {
		if env.Verbs == nil {
			commands.Install(verbs.NewTable(), env) // not verbs.Default: the CLI lists its commands there
		}
		s.Verbs = env.Verbs
	}
	key, err := cfg.Key()
	if err != nil {
		log.Printf("server key: %v (using a temporary one: sandbox labels change on restart)", err)
		key = []byte(ids.Secret("key_"))
	}
	p := &pages.Door{Cfg: cfg, Sys: sys, People: s.People, Registry: s.Registry, Ledger: s.Ledger, Gov: s.Gov, Book: s.Book,
		Web: s.web, Verbs: s.Verbs, Key: key}
	if env != nil {
		p.K, p.A, p.Confirm = env.K, env.A, env.Confirm
	}
	s.Pages = pages.New(p)
	if env != nil && env.A != nil {
		env.A.Policy = func(app, capability, audience string) bool {
			return s.Gov.Policy(context.Background(), app, capability, audience)
		}
		env.A.Secret = func(ctx context.Context, app, name string) (string, error) { return s.Gov.Secret(ctx, key, app, name) }
		s.Pages.InstallActors(env.A)
		(&actorsdoor.Door{Web: s.web, Gov: s.Gov, Verbs: s.Verbs, Confirm: env.Confirm}).Install(env.A)
	}
	s.mainRoutes(s.main)
	s.Static = http.HandlerFunc(s.Pages.ServeStatic)
	s.Live = http.HandlerFunc(s.Pages.ServeLive)
	s.Sandbox = http.HandlerFunc(s.Pages.ServeSandbox)
	return s
}

// ServeHTTP dispatches on the Host header.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch s.Cfg.HostKind(r.Host) {
	case "main":
		s.trustedDefaults(w)
		w.Header().Set("X-Frame-Options", "DENY")
		s.main.ServeHTTP(w, r)
	case "live":
		s.trustedDefaults(w)
		serveOr(s.Live, w, r)
	case "static":
		serveOr(s.Static, w, r)
	case "sandbox":
		serveOr(s.Sandbox, w, r)
	default:
		// probes reach the pod's address, not a configured host
		switch r.URL.Path {
		case "/healthz":
			_, _ = w.Write([]byte("ok\n"))
			return
		case "/readyz":
			s.ready(w, r)
			return
		}
		http.Error(w, "unknown host "+r.Host, http.StatusMisdirectedRequest)
	}
}

// trustedDefaults are the headers every response on a trusted origin (the
// main and live hosts, which hold sessions) starts with, deny by default:
// not framed, no MIME sniffing, no full referrers, HTTPS remembered. A
// handler may replace the CSP with its own (the shell's, an actor page's,
// the sandbox CSP of store bytes).
func (s *Server) trustedDefaults(w http.ResponseWriter) {
	h := w.Header()
	h.Set("Content-Security-Policy", "frame-ancestors 'none'")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "same-origin")
	if s.Cfg.Scheme == "https" {
		h.Set("Strict-Transport-Security", "max-age=31536000")
	}
}

// ready answers whether the system database answers.
func (s *Server) ready(w http.ResponseWriter, r *http.Request) {
	if err := s.Sys.PingContext(r.Context()); err != nil {
		httpx.Fail(w, 503, "unavailable", err.Error())
		return
	}
	httpx.JSON(w, 200, map[string]any{"ok": true})
}

func serveOr(h http.Handler, w http.ResponseWriter, r *http.Request) {
	if h == nil {
		http.NotFound(w, r)
		return
	}
	h.ServeHTTP(w, r)
}

func (s *Server) mainRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok\n")) })
	m.HandleFunc("GET /readyz", s.ready)
	s.Pages.MainRoutes(m)
	s.auth.Routes(m)
	s.billingDoor.Routes(m)
	(&apidoor.Door{Web: s.web, People: s.People, Verbs: s.Verbs}).Routes(m)
	(&mcpdoor.Door{Cfg: s.Cfg, Web: s.web, People: s.People, Verbs: s.Verbs}).Routes(m)
	(&officedoor.Door{Cfg: s.Cfg}).Routes(m)
}

// ListenAndServe runs the server until ctx ends.
func (s *Server) ListenAndServe(ctx context.Context) error {
	srv := &http.Server{Addr: s.Cfg.Listen, Handler: s, ReadHeaderTimeout: 10 * time.Second}
	if s.Env.A != nil {
		s.Env.A.Start(ctx)
	}
	if s.billing != nil {
		go func() { _ = s.billing.Run(ctx) }()
	}
	go func() {
		t := time.NewTicker(time.Minute)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-t.C:
				s.Pages.Tick(ctx, now)           // expired views; comps and subscription periods that ended
				_, _ = s.Ledger.ExpireHolds(ctx) // model rounds whose outcome never arrived: charged in full
			}
		}
	}()
	// Guests unseen for 90 days go, once a day (and once at start).
	go func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			if n, err := s.Env.K.SweepGuests(ctx, identity.GuestCutoff(time.Now())); err != nil {
				log.Printf("guest sweep: %v", err)
			} else if n > 0 {
				log.Printf("swept %d guests", n)
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}()
	go func() {
		<-ctx.Done()
		c, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(c)
	}()
	err := srv.ListenAndServe()
	if err == http.ErrServerClosed {
		return nil
	}
	return err
}
