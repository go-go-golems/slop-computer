package server

import (
	"context"
	"net/http"
	"strings"
	"sync"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/verbs"
)

// The HTTP door: POST /api/v1/<verb> with the arguments as JSON.

// maxAPIBody fits a 50 MiB tree file as base64, plus its manifest.
const maxAPIBody = 96 << 20

func (s *Server) apiRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/verbs", func(w http.ResponseWriter, r *http.Request) {
		httpx.JSON(w, 200, map[string]any{"verbs": s.Verbs.All()})
	})
	m.HandleFunc("POST /api/v1/{verb}", s.apiCall)
}

// apiPrincipal authenticates an API call: a token, or a session with its
// CSRF header. Nobody is an error.
func (s *Server) apiPrincipal(w http.ResponseWriter, r *http.Request) *access.Principal {
	p, sess, err := s.principalOf(r)
	if err != nil || p == nil {
		httpx.Fail(w, 401, "unauthenticated", "sign in, or send Authorization: Bearer <token>")
		return nil
	}
	if sess != nil && r.Header.Get("X-CSRF-Token") != sess.CSRF {
		httpx.Fail(w, 403, "permission_denied", "missing or wrong X-CSRF-Token")
		return nil
	}
	if p.Kind == access.KindToken {
		p.Via = "http"
	} else {
		p.Via = "office"
	}
	return p
}

func (s *Server) apiCall(w http.ResponseWriter, r *http.Request) {
	p := s.apiPrincipal(w, r)
	if p == nil {
		return
	}
	name := r.PathValue("verb")
	if hv := r.Header.Get("X-Slop-Via"); hv == "cli" && p.Kind == access.KindToken {
		p.Via = "cli"
	}
	args := verbs.Args{}
	if r.ContentLength != 0 {
		if err := httpx.Read(r, &args, maxAPIBody); err != nil {
			httpx.Fail(w, 400, "invalid_argument", "the body must be a JSON object of arguments")
			return
		}
	}
	s.Sys.TouchPerson(r.Context(), p.ID())
	ctx := withPrincipal(r.Context(), p)
	if v, ok := s.Verbs.Get(name); ok && v.Effect == verbs.EffectStream && strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		s.apiStream(ctx, w, p, name, args)
		return
	}
	res, err := s.Verbs.Call(ctx, p, name, args)
	if err != nil {
		e := verbs.AsError(err)
		httpx.JSON(w, e.Status(), map[string]any{"error": e})
		return
	}
	httpx.JSON(w, 200, map[string]any{"result": res})
}

// apiStream runs a stream verb for a caller that accepts text/event-stream:
// each part is a "part" event, then one "result" or "error" event. Until
// the first part the answer is not yet a stream, so a refusal (arguments,
// authority) is an ordinary JSON error with its status.
func (s *Server) apiStream(ctx context.Context, w http.ResponseWriter, p *access.Principal, name string, args verbs.Args) {
	flusher, _ := w.(http.Flusher)
	var mu sync.Mutex
	started := false
	send := func(typ string, data any) {
		if !started {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Accel-Buffering", "no")
			w.WriteHeader(http.StatusOK)
			started = true
		}
		_ = writeSSE(w, typ, data)
		if flusher != nil {
			flusher.Flush()
		}
	}
	ctx = verbs.WithEmit(ctx, func(part any) error {
		mu.Lock()
		defer mu.Unlock()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		send("part", part)
		return nil
	})
	res, err := s.Verbs.Call(ctx, p, name, args)
	mu.Lock()
	defer mu.Unlock()
	switch {
	case err != nil && !started:
		e := verbs.AsError(err)
		httpx.JSON(w, e.Status(), map[string]any{"error": e})
	case err != nil:
		send("error", map[string]any{"error": verbs.AsError(err)})
	case !started:
		httpx.JSON(w, 200, map[string]any{"result": res})
	default:
		send("result", map[string]any{"result": res})
	}
}
