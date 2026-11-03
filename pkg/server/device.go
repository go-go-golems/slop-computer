package server

import (
	"errors"
	"html/template"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/identity"
	"github.com/go-go-golems/slop-computer/pkg/sysdb"
)

// Device login: the CLI asks for a code, a person approves it in the
// browser, the CLI collects a token. Ported from slop-computer's
// pkg/server/device.go onto system.db.

const deviceDays = 30

func (s *Server) deviceRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /auth/device", s.deviceStart)
	m.HandleFunc("POST /auth/device/token", s.deviceToken)
	m.HandleFunc("GET /device", s.devicePage)
	m.HandleFunc("POST /device", s.deviceDecide)
}

func (s *Server) deviceStart(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name   string   `json:"name"`
		Scopes []string `json:"scopes"`
		Days   *int     `json:"days"`
	}
	if err := httpx.Read(r, &in, 4096); err != nil {
		httpx.Fail(w, 400, "invalid_argument", "send {name, scopes, days}")
		return
	}
	name, days := strings.TrimSpace(in.Name), deviceDays
	if in.Days != nil {
		days = *in.Days
	}
	if name == "" || len(name) > 80 || days < 0 || days > 366 {
		httpx.Fail(w, 400, "invalid_argument", "a client name (at most 80 characters) and 0–366 days are required")
		return
	}
	for _, sc := range in.Scopes {
		if sc != sysdb.ScopeRead && sc != sysdb.ScopeWrite && sc != sysdb.ScopeAdmin {
			httpx.Fail(w, 400, "invalid_argument", "unknown scope "+sc)
			return
		}
	}
	secret, dc, err := s.People.StartDevice(r.Context(), name, in.Scopes, days)
	if err != nil {
		httpx.Fail(w, 500, "internal", err.Error())
		return
	}
	httpx.JSON(w, 200, map[string]any{
		"deviceCode": secret, "userCode": dc.UserCode, "interval": 2, "expiresAt": dc.ExpiresAt,
		"verificationUrl":         s.Cfg.MainURL() + "/device",
		"verificationUrlComplete": s.Cfg.MainURL() + "/device?code=" + url.QueryEscape(dc.UserCode),
	})
}

func (s *Server) deviceToken(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DeviceCode string `json:"deviceCode"`
	}
	if err := httpx.Read(r, &in, 4096); err != nil || in.DeviceCode == "" {
		httpx.Fail(w, 400, "invalid_argument", "send {deviceCode}")
		return
	}
	secret, t, err := s.People.PollDevice(r.Context(), in.DeviceCode)
	switch {
	case errors.Is(err, identity.ErrPending):
		httpx.Fail(w, 428, "authorization_pending", "waiting for approval in the browser")
	case errors.Is(err, identity.ErrDenied):
		httpx.Fail(w, 403, "access_denied", "the login was denied")
	case err != nil:
		httpx.Fail(w, 404, "expired_token", "this login expired or was already used")
	default:
		p, _ := s.People.Person(r.Context(), t.Person)
		httpx.JSON(w, 200, map[string]any{"token": secret, "tokenId": t.ID, "name": t.Name, "scopes": t.Scopes,
			"expiresAt": t.ExpiresAt, "user": p})
	}
}

var deviceTmpl = template.Must(template.New("device").Parse(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Approve a login · slop</title>
<style>body{font:15px/1.5 Arial,sans-serif;color:#1a1a1a;margin:0;display:grid;place-items:center;min-height:100vh}
form{border:1px solid #d6d6d6;padding:24px 28px;min-width:320px}h1{font-size:18px;margin:0 0 12px}
label{display:block;margin:10px 0 4px;color:#737373;font-size:13px}input[type=text],input[type=number]{width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid #d6d6d6;font:inherit}
button{margin:16px 8px 0 0;padding:7px 14px;border:1px solid #1a1a1a;background:#fff;font:inherit;cursor:pointer}
button.go{background:#1a1a1a;color:#fff}.err{color:#e2001a}.code{font:600 20px monospace;letter-spacing:2px}</style>
<form method="post" action="/device">
{{if .Code}}<h1>Approve “{{.Name}}”?</h1>
<p>Code <span class="code">{{.Code}}</span>. It will act as <b>{{.Who}}</b>.</p>
<input type="hidden" name="code" value="{{.Code}}"><input type="hidden" name="csrf" value="{{.CSRF}}">
<label>Scopes</label>{{range .Allowed}}<label style="color:#1a1a1a"><input type="checkbox" name="scope" value="{{.}}" {{if index $.Checked .}}checked{{end}}> {{.}}</label>{{end}}
<label>Expires in days (0 = never; admin tokens 1–90)</label><input type="number" name="days" value="{{.Days}}">
<button class="go" name="decision" value="approve">Approve</button><button name="decision" value="deny">Deny</button>
{{else}}<h1>Approve a login</h1><label>Code shown by the CLI</label><input type="text" name="lookup" autofocus>
<input type="hidden" name="csrf" value="{{.CSRF}}"><button class="go">Continue</button>{{end}}
{{if .Problem}}<p class="err">{{.Problem}}</p>{{end}}</form>`))

func (s *Server) devicePage(w http.ResponseWriter, r *http.Request) {
	p, sess, _ := s.web.Principal(r)
	if p == nil || sess == nil {
		http.Redirect(w, r, "/auth/login?return="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	data := map[string]any{"CSRF": sess.CSRF, "Problem": r.URL.Query().Get("problem")}
	if code := r.URL.Query().Get("code"); code != "" {
		dc, err := s.People.DeviceByUserCode(r.Context(), code)
		if err != nil {
			data["Problem"] = "That code is unknown or expired."
		} else {
			allowed := identity.ScopesForRole(p.Person.Role)
			checked := map[string]bool{}
			for _, sc := range dc.Scopes {
				checked[sc] = true
			}
			if len(dc.Scopes) == 0 {
				for _, sc := range allowed {
					checked[sc] = true
				}
			}
			days := dc.Days
			if checked[sysdb.ScopeAdmin] && (days < 1 || days > identity.MaxAdminTokenDays) {
				days = identity.MaxAdminTokenDays
			}
			data["Code"], data["Name"], data["Who"] = dc.UserCode, dc.Name, p.Person.Name+" ("+p.Person.Role+")"
			data["Allowed"], data["Checked"], data["Days"] = allowed, checked, days
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = deviceTmpl.Execute(w, data)
}

func (s *Server) deviceDecide(w http.ResponseWriter, r *http.Request) {
	p, sess, _ := s.web.Principal(r)
	if p == nil || sess == nil {
		http.Redirect(w, r, "/auth/login?return=/device", http.StatusSeeOther)
		return
	}
	if err := r.ParseForm(); err != nil || r.PostForm.Get("csrf") != sess.CSRF {
		http.Error(w, "bad form", http.StatusForbidden)
		return
	}
	if lookup := r.PostForm.Get("lookup"); lookup != "" {
		http.Redirect(w, r, "/device?code="+url.QueryEscape(strings.ToUpper(strings.TrimSpace(lookup))), http.StatusSeeOther)
		return
	}
	code := r.PostForm.Get("code")
	back := "/device?code=" + url.QueryEscape(code)
	if r.PostForm.Get("decision") == "deny" {
		_ = s.People.ApproveDevice(r.Context(), code, p.ID(), nil, 0, true)
		writeDone(w, "Denied. You can close this page.")
		return
	}
	days, _ := strconv.Atoi(r.PostForm.Get("days"))
	scopes, err := identity.CheckTokenGrant(p.Person.Role, r.PostForm["scope"], days)
	if err != nil {
		http.Redirect(w, r, back+"&problem="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	if err := s.People.ApproveDevice(r.Context(), code, p.ID(), scopes, days, false); err != nil {
		http.Redirect(w, r, back+"&problem="+url.QueryEscape(err.Error()), http.StatusSeeOther)
		return
	}
	writeDone(w, "Approved. The CLI has its token; you can close this page.")
}

func writeDone(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><title>slop</title><body style="font:15px Arial,sans-serif;display:grid;place-items:center;min-height:100vh"><p>` +
		template.HTMLEscapeString(msg) + `</p>`))
}
