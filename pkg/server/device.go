package server

import (
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// Device login (ported from francois pkg/catalog/device.go): `slop auth
// login` asks for a code pair, the user approves the user code at /device in
// a signed-in browser, and the CLI's next poll receives a personal API token
// minted from that approval.

const (
	deviceCodePrefix = "sdc_"
	deviceInterval   = 5 * time.Second
	deviceDays       = 90 // requested lifetime when the CLI names none
)

func (s *Server) deviceRoutes(m *http.ServeMux) {
	m.HandleFunc("POST /api/device/authorize", s.guard(public, noToken, s.deviceAuthorize))
	m.HandleFunc("POST /api/device/token", s.guard(public, noToken, s.deviceToken))
	m.HandleFunc("GET /device", s.guard(public, noToken, s.devicePage))
	m.HandleFunc("POST /device", s.guard(admin, noToken, s.deviceDecide))
}

func knownScope(sc string) bool {
	return sc == store.ScopeRead || sc == store.ScopeWrite || sc == store.ScopeAdmin
}

// deviceAuthorize starts a device login for the CLI.
func (s *Server) deviceAuthorize(w http.ResponseWriter, r *http.Request) {
	addr := s.clientAddress(r)
	if !s.deviceLimiter.take("authorize:"+addr, 20, time.Hour) || !s.deviceLimiter.take("authorize", 600, time.Hour) {
		httpx.Fail(w, 429, "rate_limited", "Too many login attempts; try again later")
		return
	}
	var in struct {
		ClientName string   `json:"clientName"`
		Scopes     []string `json:"scopes"`
		Days       *int     `json:"days"`
	}
	if err := httpx.Read(w, r, &in, 2048); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Invalid JSON body")
		return
	}
	name, days := strings.TrimSpace(in.ClientName), deviceDays
	if in.Days != nil {
		days = *in.Days
	}
	if name == "" || len(name) > 80 || days < 0 || days > 366 {
		httpx.Fail(w, 400, "invalid_request", "A client name (≤80) and a lifetime of 0–366 days (0 = no expiry) are required")
		return
	}
	scopes := []string{}
	for _, sc := range in.Scopes {
		if !knownScope(sc) {
			httpx.Fail(w, 400, "invalid_scopes", "Unknown scope "+sc)
			return
		}
		if !slices.Contains(scopes, sc) {
			scopes = append(scopes, sc)
		}
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		unavailable(w, err)
		return
	}
	device := deviceCodePrefix + base64.RawURLEncoding.EncodeToString(b)
	origin := s.requestOrigin(r)
	var code string
	var err error
	for range 3 {
		code = store.NewUserCode()
		err = s.Store.CreateDeviceAuthorization(r.Context(), device, code, store.DeviceAuthorization{Origin: origin, ClientName: name,
			RequestedScopes: scopes, RequestedDays: days, RequesterAddress: addr, Interval: deviceInterval})
		if !errors.Is(err, store.ErrConflict) {
			break
		}
	}
	if err != nil {
		unavailable(w, err)
		return
	}
	shown := store.FormatUserCode(code)
	httpx.JSON(w, 201, map[string]any{"deviceCode": device, "userCode": shown, "verificationUri": origin + "/device",
		"verificationUriComplete": origin + "/device?code=" + shown, "expiresIn": int(store.DeviceTTL.Seconds()), "interval": int(deviceInterval.Seconds())})
}

// deviceToken answers the CLI's poll.
func (s *Server) deviceToken(w http.ResponseWriter, r *http.Request) {
	if !s.deviceLimiter.take("poll:"+s.clientAddress(r), 1200, time.Hour) {
		httpx.Fail(w, 429, "rate_limited", "Too many polls; try again later")
		return
	}
	var in struct {
		DeviceCode string `json:"deviceCode"`
	}
	if err := httpx.Read(w, r, &in, 1024); err != nil || !strings.HasPrefix(in.DeviceCode, deviceCodePrefix) {
		httpx.Fail(w, 400, "expired_token", "Unknown or expired device code; start the login again")
		return
	}
	poll, err := s.Store.PollDevice(r.Context(), in.DeviceCode, s.requestOrigin(r), func(u store.User, scopes []string, days int) ([]string, *time.Time, error) {
		scopes, expires, gerr := tokenGrant(u.Role, scopes, days)
		if gerr != nil {
			return nil, nil, gerr
		}
		return scopes, expires, nil
	})
	if err != nil {
		unavailable(w, err)
		return
	}
	switch poll.State {
	case store.DevicePending:
		httpx.Fail(w, 400, "authorization_pending", "Waiting for approval in the browser")
	case store.DeviceSlow:
		httpx.Fail(w, 400, "slow_down", "Polling too fast; wait longer between polls")
	case store.DeviceDenied:
		httpx.Fail(w, 400, "access_denied", "The login was denied")
	case store.DeviceIssued:
		t := poll.Token
		_ = s.Store.Audit(store.WithAuditVia(r.Context(), "device"), poll.User.ID, "token.create", t.ID, map[string]any{"name": t.Name, "scopes": t.Scopes, "expiresAt": t.ExpiresAt})
		httpx.OK(w, map[string]any{"token": poll.Secret, "info": t, "user": meUser(poll.User)})
	default:
		httpx.Fail(w, 400, "expired_token", "Unknown or expired device code; start the login again")
	}
}

// suggestGrant pre-selects the approval form: the requested scopes the role
// allows, or every scope the role allows when the CLI asked for none.
func suggestGrant(allowed, requested []string, days int) ([]string, int) {
	out := []string{}
	for _, sc := range requested {
		if slices.Contains(allowed, sc) && !slices.Contains(out, sc) {
			out = append(out, sc)
		}
	}
	if len(requested) == 0 {
		out = append(out, allowed...)
	}
	if slices.Contains(out, store.ScopeAdmin) && (days < 1 || days > maxAdminTokenDays) {
		days = maxAdminTokenDays
	}
	return out, days
}

// devicePage shows the approval form for ?code=, or a field to type it.
func (s *Server) devicePage(w http.ResponseWriter, r *http.Request) {
	p := principal(r.Context())
	if p == nil {
		http.Redirect(w, r, "/auth/login?return="+urlQueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
		return
	}
	data := map[string]any{"Me": p.User, "CSRF": p.Session.CSRF, "Code": r.URL.Query().Get("code")}
	if p.User.Role != store.RoleAdmin {
		data["Problem"] = "An administrator has to let you in before you can approve logins."
		s.render(w, http.StatusForbidden, "device", data)
		return
	}
	if raw := r.URL.Query().Get("code"); raw != "" {
		code, ok := store.NormalizeUserCode(raw)
		var d store.DeviceAuthorization
		var err error
		if ok {
			d, err = s.Store.DeviceRequest(r.Context(), code, s.requestOrigin(r))
		}
		if !ok || errors.Is(err, store.ErrNotFound) {
			data["Problem"] = "This code is invalid or has expired. Check that the whole link was copied, or type the code the terminal shows."
		} else if err != nil {
			unavailable(w, err)
			return
		} else {
			allowed := store.ScopesForRole(p.User.Role)
			suggested, days := suggestGrant(allowed, d.RequestedScopes, d.RequestedDays)
			data["Request"] = d
			data["Code"] = store.FormatUserCode(code)
			data["Allowed"] = allowed
			data["Suggested"] = suggested
			data["Days"] = days
		}
	}
	s.render(w, http.StatusOK, "device", data)
}

// deviceDecide approves or denies a pending login from the approval form.
func (s *Server) deviceDecide(w http.ResponseWriter, r *http.Request) {
	if !s.deviceLimiter.left("lookup:"+actor(r), 30, time.Hour) {
		httpx.Fail(w, 429, "rate_limited", "Too many unknown codes; try again later")
		return
	}
	code, ok := store.NormalizeUserCode(r.PostFormValue("code"))
	origin := s.requestOrigin(r)
	d, err := s.Store.DeviceRequest(r.Context(), code, origin)
	if !ok || errors.Is(err, store.ErrNotFound) {
		s.deviceLimiter.take("lookup:"+actor(r), 30, time.Hour)
		s.render(w, http.StatusNotFound, "device", map[string]any{"Me": me(r), "CSRF": principal(r.Context()).Session.CSRF, "Problem": "This code is invalid or has expired. Check that the whole link was copied, or type the code the terminal shows."})
		return
	}
	if err != nil {
		unavailable(w, err)
		return
	}
	if r.PostFormValue("decision") != "approve" {
		if err = s.Store.DenyDevice(r.Context(), code, origin, actor(r)); err != nil && !errors.Is(err, store.ErrNotFound) {
			unavailable(w, err)
			return
		}
		_ = s.Store.Audit(r.Context(), actor(r), "token.device_deny", actor(r), map[string]any{"client": d.ClientName, "requestedFrom": d.RequesterAddress})
		s.render(w, http.StatusOK, "device-done", map[string]any{"Approved": false, "Client": d.ClientName})
		return
	}
	days, _ := strconv.Atoi(r.PostFormValue("days"))
	scopes, _, gerr := tokenGrant(me(r).Role, r.PostForm["scope"], days)
	if gerr != nil {
		s.render(w, gerr.status, "device", map[string]any{"Me": me(r), "CSRF": principal(r.Context()).Session.CSRF, "Problem": gerr.message})
		return
	}
	if err = s.Store.ApproveDevice(r.Context(), code, origin, actor(r), scopes, days); err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(r.Context(), actor(r), "token.device_approve", actor(r), map[string]any{"client": d.ClientName, "scopes": scopes, "days": days, "requestedFrom": d.RequesterAddress})
	s.render(w, http.StatusOK, "device-done", map[string]any{"Approved": true, "Client": d.ClientName, "Scopes": scopes})
}
