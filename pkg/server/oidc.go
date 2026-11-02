package server

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-go-golems/slop/pkg/identity"
	"github.com/go-go-golems/slop/pkg/ids"
	"github.com/go-go-golems/slop/pkg/system"
)

// flowCookie binds an OIDC flow to the browser that started it.
func (s *Server) flowCookie() string {
	if s.Cfg.SecureCookies() {
		return "__Host-slop_flow"
	}
	return "slop_flow"
}

// setupOIDC builds the relying party from the config; discovery is lazy,
// so the server starts (and sessions keep working) while the provider is
// down.
func (s *Server) setupOIDC() error {
	c := s.Cfg.OIDC
	if s.Cfg.Local || c.Issuer == "" {
		return nil
	}
	id, err := readSecret(c.ClientIDFile)
	if err != nil {
		return fmt.Errorf("oidc client_id_file: %w", err)
	}
	secret := ""
	if c.ClientSecretFile != "" {
		if secret, err = readSecret(c.ClientSecretFile); err != nil {
			return fmt.Errorf("oidc client_secret_file: %w", err)
		}
	}
	extra := strings.Fields(c.Scope)
	if err := identity.ValidateScopes(extra); err != nil {
		return err
	}
	s.oidc = identity.New(identity.Config{Issuer: c.Issuer, ClientID: id, ClientSecret: secret,
		RedirectURL: s.Cfg.MainURL() + "/auth/callback", ExtraScopes: extra})
	s.oidcLogin = s.oidcStart
	return nil
}

func readSecret(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	v := strings.TrimSpace(string(b))
	if v == "" {
		return "", fmt.Errorf("%s is empty", path)
	}
	return v, nil
}

// oidcStart sends the browser to the provider with S256 PKCE and a nonce.
func (s *Server) oidcStart(w http.ResponseWriter, r *http.Request, ret string) {
	state, nonce, verifier, binding := ids.New("", 32), ids.New("", 24), ids.New("", 43), ids.New("", 32)
	if err := s.Sys.SaveLoginFlow(r.Context(), state, system.LoginFlow{BindingHash: ids.Hash(binding), Nonce: nonce, Verifier: verifier, ReturnPath: ret}, 10*time.Minute); err != nil {
		http.Error(w, "could not start sign-in", http.StatusServiceUnavailable)
		return
	}
	target, err := s.oidc.AuthURL(r.Context(), state, nonce, verifier, "", "")
	if err != nil {
		log.Printf("oidc discovery: %v", err)
		s.signInFailed(w, r, "The sign-in provider is not reachable right now.", ret)
		return
	}
	s.setCookie(w, s.flowCookie(), binding, 600, http.SameSiteLaxMode)
	http.Redirect(w, r, target, http.StatusSeeOther)
}

// oidcCallback finishes the flow: the state must name a live flow started
// in this browser, and the code is exchanged with its verifier.
func (s *Server) oidcCallback(w http.ResponseWriter, r *http.Request) {
	if s.oidc == nil {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	state := q.Get("state")
	if q.Get("error") != "" {
		s.signInFailed(w, r, "Sign-in was cancelled or refused.", s.Sys.LoginFlowReturn(r.Context(), state))
		return
	}
	c, err := r.Cookie(s.flowCookie())
	if err != nil || c.Value == "" || state == "" || q.Get("code") == "" {
		s.signInFailed(w, r, "This sign-in was started in another browser or has expired.", s.Sys.LoginFlowReturn(r.Context(), state))
		return
	}
	flow, err := s.Sys.ConsumeLoginFlow(r.Context(), state, ids.Hash(c.Value))
	if err != nil {
		s.signInFailed(w, r, "This sign-in was started in another browser or has expired.", "/")
		return
	}
	s.setCookie(w, s.flowCookie(), "", -1, http.SameSiteLaxMode)
	id, _, err := s.oidc.Exchange(r.Context(), q.Get("code"), flow.Verifier, flow.Nonce)
	if err != nil {
		log.Printf("oidc exchange: %v", err)
		s.signInFailed(w, r, "The sign-in could not be completed.", flow.ReturnPath)
		return
	}
	if id.Email == "" || !id.EmailVerified {
		s.signInFailed(w, r, "Your account needs a verified email address.", flow.ReturnPath)
		return
	}
	if err := s.signIn(w, r, id.Email, id.Name, id.Issuer+"|"+id.Subject); err != nil {
		s.signInFailed(w, r, err.Error(), flow.ReturnPath)
		return
	}
	http.Redirect(w, r, flow.ReturnPath, http.StatusSeeOther)
}

// signInFailed shows the problem with a way to start again.
func (s *Server) signInFailed(w http.ResponseWriter, r *http.Request, problem, ret string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusBadRequest)
	_ = signInFailedTmpl.Execute(w, map[string]string{"Problem": problem, "Again": "/auth/login?return=" + url.QueryEscape(safeReturn(ret))})
}
