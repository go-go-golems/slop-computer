// Package server is slop's HTTP server: the main host (Workshop, sign-in,
// JSON API), and later the site hosts and the sandbox domain.
//
// The request guard, sign-in, tokens and device login are ported from
// github.com/go-go-golems/francois@106776a pkg/catalog.
package server

import (
	"context"
	"golang.org/x/sync/singleflight"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/blobs"
	"github.com/go-go-golems/slop-computer/pkg/events"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/piworker"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// LocalConfig enables local mode: nickname sign-in instead of OIDC.
type LocalConfig struct {
	// Role is given to a nickname the first time it signs in.
	Role string
}

type Config struct {
	// PublicURL is the main host's origin, such as https://slop.computer.
	PublicURL *url.URL
	// ExtraOrigins are further origins that reach the main host: the Vite dev
	// server (--dev-origin) and, in local mode, the 127.0.0.1 spelling.
	ExtraOrigins []string
	// OIDC signs people in; nil in local mode.
	OIDC *identity.Provider
	// Local enables nickname sign-in; nil unless --auth local.
	Local *LocalConfig
	// SiteHosts are hosts served through the route table, such as
	// slop.boutique or site.localhost:8080.
	SiteHosts []string
	// SandboxDomain serves previews at s<label>.<domain>, such as slop.run or
	// sandbox.localhost:8080.
	SandboxDomain string
	// TrustProxyHeaders takes the client address from X-Real-Ip / X-Forwarded-For.
	TrustProxyHeaders bool
	// Workshop is the Workshop's build (pkg/web); nil shows a placeholder.
	Workshop fs.FS
	// Sample answers the sample capability (the Pi worker); nil turns it off.
	Sample piworker.Backend
}

func (c Config) Secure() bool { return c.PublicURL.Scheme == "https" }

// Validate checks the configuration, including local mode's guard rails.
func (c Config) Validate(listen string) error {
	if c.PublicURL == nil || (c.PublicURL.Scheme != "http" && c.PublicURL.Scheme != "https") || c.PublicURL.Host == "" {
		return errors.New("public-url must be an origin such as https://slop.computer")
	}
	if c.Local != nil {
		if c.OIDC != nil {
			return errors.New("choose either local mode or OIDC")
		}
		if err := identity.CheckLocalSafe(listen, c.PublicURL); err != nil {
			return err
		}
		if !store.ValidRole(c.Local.Role) {
			return errors.Errorf("invalid local role %q", c.Local.Role)
		}
	} else if c.OIDC == nil || !c.OIDC.Configured() {
		return errors.New("configure OIDC (--oidc-issuer, --oidc-client-id) or use --local")
	}
	for _, o := range c.ExtraOrigins {
		if u, err := url.Parse(o); err != nil || u.Host == "" || (u.Path != "" && u.Path != "/") {
			return errors.Errorf("extra origin %q must be an origin such as http://localhost:5173", o)
		}
	}
	return nil
}

type Server struct {
	Config        Config
	Store         *store.Store
	Blobs         *blobs.Blobs
	Events        *events.Broker
	mux           *http.ServeMux
	deviceLimiter *limiter
	waiters       *waiters
	views         *rt.Registry
	caps          capsCache
	roomMu        sync.Mutex
	joined        map[string][]string // view id → named rooms
	samples       samples
	recCache      recordCache
	site          siteCache
	derived       singleflight.Group // derived-file builds, by name (files.go)
	thumbSlots    chan struct{}      // concurrent image decodes (thumbs.go)
	siteMux       *http.ServeMux     // /_site/ on site hosts (live.go)
}

func New(cfg Config, st *store.Store, bl *blobs.Blobs) *Server {
	s := &Server{Config: cfg, Store: st, Blobs: bl, Events: events.New(), deviceLimiter: newLimiter(), waiters: newWaiters(),
		views: rt.NewRegistry(), joined: map[string][]string{}, thumbSlots: make(chan struct{}, thumbSlots)}
	s.views.OnClose = s.roomClosed
	s.mux = s.routes()
	s.siteMux = s.siteLiveRoutes()
	go func() {
		for now := range time.Tick(5 * time.Second) {
			s.views.Sweep(now)
		}
	}()
	return s
}

// publish hands committed events to live subscribers.
// publish sends committed events to subscribers; a change that can alter a
// site index makes the cached indexes stale first.
func (s *Server) publish(evs []store.Event) {
	s.site.changed(evs)
	s.Events.Publish(evs...)
}

// origins are the main host's origins: the public URL first.
func (s *Server) origins() []string {
	out := []string{origin(s.Config.PublicURL)}
	for _, o := range s.Config.ExtraOrigins {
		out = append(out, strings.TrimRight(o, "/"))
	}
	return out
}

func origin(u *url.URL) string { return u.Scheme + "://" + u.Host }

// requestOrigin is the main-host origin a request arrived on (so links and
// device approval URLs stay on the host the browser uses), else the public URL.
func (s *Server) requestOrigin(r *http.Request) string {
	host := strings.ToLower(r.Host)
	for _, o := range s.origins() {
		if u, err := url.Parse(o); err == nil && strings.ToLower(u.Host) == host {
			return o
		}
	}
	return s.origins()[0]
}

// isMainHost reports whether host is one of the main host's origins.
func (s *Server) isMainHost(host string) bool {
	host = strings.ToLower(host)
	for _, o := range s.origins() {
		if u, err := url.Parse(o); err == nil && strings.ToLower(u.Host) == host {
			return true
		}
	}
	return false
}

// Handler answers every host the server serves.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if s.Config.Secure() {
			// Main host and site hosts are HTTPS-only in production. Not
			// includeSubDomains: the sandbox domain is separate and site hosts
			// may be other people's domains.
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if s.Config.Local != nil {
			w.Header().Set("X-Slop-Mode", "local")
		}
		host := strings.ToLower(r.Host)
		if !s.isMainHost(host) {
			if label, ok := s.sandboxLabel(host); ok {
				s.serveSandbox(w, r, label)
				return
			}
			for _, h := range s.Config.SiteHosts {
				if strings.EqualFold(h, host) {
					s.serveSite(w, r)
					return
				}
			}
			// Probes (kubelet, Docker HEALTHCHECK) address the pod or
			// container, not a configured host.
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
				s.mux.ServeHTTP(w, r)
				return
			}
			http.Error(w, "unknown host", http.StatusMisdirectedRequest)
			return
		}
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "same-origin")
		s.mux.ServeHTTP(w, r)
	})
}

func (s *Server) routes() *http.ServeMux {
	m := http.NewServeMux()
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) { httpx.OK(w, map[string]string{"status": "ok"}) })
	m.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := s.Store.Ping(ctx); err != nil {
			httpx.Fail(w, 503, "database_unavailable", "Database unavailable")
			return
		}
		httpx.OK(w, map[string]string{"status": "ready"})
	})
	s.authRoutes(m)
	s.tokenRoutes(m)
	s.deviceRoutes(m)
	s.userRoutes(m)
	s.kernelRoutes(m)
	s.previewRoutes(m)
	s.streamRoutes(m)
	s.rtRoutes(m)
	s.siteRoutes(m)
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { httpx.Fail(w, 404, "not_found", "Unknown API route") })
	s.workshopRoutes(m)
	s.safeRoutes(m)
	s.helpRoutes(m)
	m.HandleFunc("GET /static/", s.staticFile)
	return m
}

// clientAddress is the caller's IP address.
func (s *Server) clientAddress(r *http.Request) string {
	if s.Config.TrustProxyHeaders {
		if ip := strings.TrimSpace(r.Header.Get("X-Real-Ip")); ip != "" {
			return ip
		}
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			return strings.TrimSpace(strings.Split(fwd, ",")[0])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func unavailable(w http.ResponseWriter, err error) {
	unavailableLog(err)
	httpx.Fail(w, 503, "unavailable", "Request failed")
}

func unavailableLog(err error) { log.Error().Err(err).Msg("request failed") }
