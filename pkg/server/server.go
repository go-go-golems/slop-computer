// Package server is the HTTP side of slop: one handler that dispatches on
// the Host header to the main host (back office, sign-in, /api/v1), live
// hosts, static hosts and sandbox origins.
package server

import (
	"context"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-go-golems/slop/pkg/billing/stripe"
	"github.com/go-go-golems/slop/pkg/config"
	"github.com/go-go-golems/slop/pkg/httpx"
	"github.com/go-go-golems/slop/pkg/identity"
	"github.com/go-go-golems/slop/pkg/ids"
	"github.com/go-go-golems/slop/pkg/rt"
	"github.com/go-go-golems/slop/pkg/system"
	"github.com/go-go-golems/slop/pkg/verbs"
)

// Server holds the shared state of every host.
type Server struct {
	Cfg  *config.Config
	Sys  *system.DB
	Env  *verbs.Env
	main *http.ServeMux
	rt   *rtState
	// Extra host handlers, set by later phases (live, static, sandbox).
	Live, Static, Sandbox http.Handler
	// oidcLogin starts an OIDC sign-in (nil until OIDC is configured).
	oidcLogin func(w http.ResponseWriter, r *http.Request, ret string)
	oidc      *identity.Provider
	billing   *stripe.Service
	told      notified
}

// Build makes the server with everything the configuration enables.
func Build(ctx context.Context, cfg *config.Config, sys *system.DB, env *verbs.Env) (*Server, error) {
	s := New(cfg, sys, env)
	if err := s.setupOIDC(); err != nil {
		return nil, err
	}
	if err := s.setupBilling(); err != nil {
		return nil, err
	}
	return s, nil
}

// New builds a server.
func New(cfg *config.Config, sys *system.DB, env *verbs.Env) *Server {
	s := &Server{Cfg: cfg, Sys: sys, Env: env, main: http.NewServeMux()}
	key, err := cfg.Key()
	if err != nil {
		log.Printf("server key: %v (using a temporary one: sandbox labels change on restart)", err)
		key = []byte(ids.Secret("key_"))
	}
	s.rt = newRT(key)
	env.AccessChanged = s.reviewViews
	env.PersonChanged = s.reviewPerson
	s.rt.views.OnClose = s.roomClosed
	if env != nil && env.K != nil {
		env.K.Subscribe(s.publish)
	}
	if env != nil && env.A != nil {
		env.A.RoomEmit = s.actorEmit
		env.A.RoomPeers = func(store string) []rt.Peer {
			out := []rt.Peer{}
			for _, v := range s.rt.views.Of(store) {
				if p, ok := v.AsPeer(""); ok {
					out = append(out, p)
				}
			}
			return out
		}
	}
	s.mainRoutes(s.main)
	s.Static = http.HandlerFunc(s.serveStatic)
	s.Live = http.HandlerFunc(s.serveLive)
	s.Sandbox = http.HandlerFunc(s.serveSandbox)
	return s
}

// ServeHTTP dispatches on the Host header.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch s.Cfg.HostKind(r.Host) {
	case "main":
		s.main.ServeHTTP(w, r)
	case "live":
		serveOr(s.Live, w, r)
	case "static":
		serveOr(s.Static, w, r)
	case "sandbox":
		serveOr(s.Sandbox, w, r)
	default:
		if r.URL.Path == "/healthz" {
			_, _ = w.Write([]byte("ok\n"))
			return
		}
		http.Error(w, "unknown host "+r.Host, http.StatusMisdirectedRequest)
	}
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
	m.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if err := s.Sys.PingContext(r.Context()); err != nil {
			httpx.Fail(w, 503, "unavailable", err.Error())
			return
		}
		httpx.JSON(w, 200, map[string]any{"ok": true})
	})
	m.HandleFunc("GET /auth/handoff", s.handoff)
	s.authRoutes(m)
	s.deviceRoutes(m)
	s.billingRoutes(m)
	s.apiRoutes(m)
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
				s.rt.views.Sweep(now)
				s.reviewAll(ctx) // comps and subscription periods that ended
			}
		}
	}()
	// Guests unseen for 90 days go, once a day (and once at start).
	go func() {
		t := time.NewTicker(24 * time.Hour)
		defer t.Stop()
		for {
			if n, err := s.Env.K.SweepGuests(ctx, system.GuestCutoff(time.Now())); err != nil {
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

// clientIP is the caller's address (X-Forwarded-For only behind a trusted proxy).
func (s *Server) clientIP(r *http.Request) string {
	if s.Cfg.TrustProxy {
		if f := r.Header.Get("X-Forwarded-For"); f != "" {
			return strings.TrimSpace(strings.Split(f, ",")[0])
		}
	}
	h, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return h
}
