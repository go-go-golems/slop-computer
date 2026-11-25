package pages

import (
	"net/http"
	"path/filepath"

	capagent "github.com/go-go-golems/slop-computer/pkg/doors/pages/agent"
	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// The agent capability in pages (SLOP3-025): pinocchio's chat HTTP API at
// /_rt/agent on the sandbox origin, for views that declare "agent" and may
// sample. The view's person owns the sessions; every model round is held on
// their LLM budget (pkg/caps/agent).

// agentService builds the service on first use: sessions, conversations
// and timelines in <data>/agent.
func (s *Door) agentService() (*capagent.Service, error) {
	s.agentOnce.Do(func() {
		dir := ""
		if s.Cfg != nil && s.Cfg.Data != "" {
			dir = filepath.Join(s.Cfg.Data, "agent")
		}
		s.agent, s.agentErr = capagent.New(capagent.Config{Dir: dir, Ledger: s.Ledger, Backend: func() llm.Backend {
			if s.A == nil {
				return nil
			}
			return s.A.LLM()
		}})
	})
	return s.agent, s.agentErr
}

// serveAgentRoute checks the view as sampleView does (without the budget:
// reading a conversation costs nothing; each round checks it) and hands
// the request to the service with the view's person and app.
func (s *Door) serveAgentRoute(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	switch {
	case v == nil:
		httpx.Fail(w, 401, "session_expired", s.closedMsg(r))
		return
	case !s.sampler().Available():
		httpx.Fail(w, 503, "unavailable", "this server has no model backend")
		return
	case !v.Caps.Declared["agent"]:
		httpx.Fail(w, 403, "not_declared", "this app does not declare agent")
		return
	case grantedCaps(v)["agent"] == nil:
		httpx.Fail(w, 403, "not_granted", "this app may not use the agent for "+v.Role)
		return
	}
	svc, err := s.agentService()
	if err != nil {
		httpx.Fail(w, 503, "unavailable", "the agent service failed to start: "+err.Error())
		return
	}
	ctx := capagent.WithView(r.Context(), capagent.View{User: v.User, App: v.Target, Audience: v.Role})
	svc.ServeHTTP(w, r.WithContext(ctx))
}
