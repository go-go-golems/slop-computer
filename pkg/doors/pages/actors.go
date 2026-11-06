package pages

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"slices"
	"strings"

	"github.com/go-go-golems/slop-computer/pkg/access"
	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/registry"
	"github.com/go-go-golems/slop-computer/pkg/rt"
)

// viewPrincipal rebuilds the principal of a view's person (for an actor's
// view, its event's visitor).
func (s *Door) viewPrincipal(ctx context.Context, v *rt.View) *access.Principal {
	if v.User == "" {
		return nil
	}
	via := "page"
	if v.Kind == rt.KindActor {
		via = "actor"
	}
	return s.Web.PersonAs(ctx, v.User, via)
}

func actorFail(err error) error {
	var ae *actor.Error
	if errors.As(err, &ae) {
		return &rtFail{Code: ae.Code, Message: ae.Message, Confirm: ae.Confirm}
	}
	return err
}

// rpcSlopCall calls an action of the store's actor as the viewer.
func (s *Door) rpcSlopCall(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Action string          `json:"action"`
		Args   json.RawMessage `json:"args"`
	}](raw)
	if err != nil {
		return nil, err
	}
	var in any
	if len(a.Args) > 0 {
		dec := json.NewDecoder(strings.NewReader(string(a.Args)))
		dec.UseNumber()
		_ = dec.Decode(&in)
	}
	vis := s.A.VisitorOf(ctx, s.viewPrincipal(ctx, v), v.Target)
	vis.View = v.ID
	out, err := s.A.Call(ctx, v.Target, a.Action, in, vis, "page")
	return out, actorFail(err)
}

// rpcSlopRead reads an aliased store, by the viewer's own level there.
func (s *Door) rpcSlopRead(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Alias string          `json:"alias"`
		Op    string          `json:"op"`
		Path  string          `json:"path"`
		Coll  string          `json:"coll"`
		Query json.RawMessage `json:"query"`
	}](raw)
	if err != nil {
		return nil, err
	}
	target, err := s.Registry.Binding(ctx, v.Target, a.Alias)
	if err != nil {
		return nil, rtErr("not_found", "no store is bound to %q", a.Alias)
	}
	p := s.viewPrincipal(ctx, v)
	st, d, err := s.K.Open(ctx, p, target, rt.LevelView, "reading", true)
	if err != nil {
		return nil, err
	}
	if !d.OK {
		return nil, rtErr("not_found", "nothing to read at %q", a.Alias)
	}
	rules := s.K.Rules(ctx, target)
	switch a.Op {
	case "get":
		doc, err := st.GetDoc(ctx, a.Path, func(path string) bool { return rules.CanRead(path, p.ID(), d.Level) })
		if err != nil {
			return map[string]any{"path": a.Path, "exists": false}, nil
		}
		return docResult(doc), nil
	case "query":
		q := rt.Query{}
		if len(a.Query) > 0 {
			_ = json.Unmarshal(a.Query, &q)
		}
		q.Coll = a.Coll
		docs, err := st.Query(ctx, q, func(path string) bool { return rules.CanRead(path, p.ID(), d.Level) })
		if err != nil {
			return nil, rtErr("invalid_argument", "invalid query on %q", a.Coll)
		}
		out := []map[string]any{}
		for _, doc := range docs {
			out = append(out, docResult(doc))
		}
		return map[string]any{"docs": out}, nil
	case "files", "file":
		n, err := st.Ref(ctx, "main")
		if err != nil {
			return nil, rtErr("not_found", "%s has no snapshot", a.Alias)
		}
		if a.Op == "files" {
			return st.SnapshotFiles(ctx, n)
		}
		f, err := st.SnapshotFile(ctx, n, a.Path)
		if err != nil {
			return nil, rtErr("not_found", "no file %s", a.Path)
		}
		b, err := st.ReadFile(f)
		if err != nil {
			return nil, err
		}
		return map[string]any{"path": f.Path, "type": f.Type, "text": string(b)}, nil
	}
	return nil, rtErr("invalid_argument", "unknown read %q", a.Op)
}

// actorRouteBodyLimit is the request body limit of actor routes on mounts
// without an API policy (with one, its maxBodyBytes).
const actorRouteBodyLimit = 1 << 20

// apiResponseHeaders are the response headers an actor may set on an API
// mount (SLOP3-012): everything else (Set-Cookie, a CSP, framing,
// Access-Control-*, which belongs to the cors middleware) is dropped.
var apiResponseHeaders = map[string]bool{"Cache-Control": true, "Content-Type": true, "Content-Language": true, "Etag": true,
	"Last-Modified": true, "Location": true, "Retry-After": true, "Link": true, "Vary": true}

// serveActorRoute answers a request on a mount from the store's actor when
// one of its http routes matches. It reports whether it answered. A mount
// with an API policy (SLOP3-012) answers only below its prefix, only with
// the routes its allowlist covers, at the level its floors require, and
// filters what the actor sends back.
func (s *Door) serveActorRoute(w http.ResponseWriter, r *http.Request, res *resolved, p *access.Principal) bool {
	if s.A == nil || res.run.Manifest == nil || res.run.Manifest.Actor == "" {
		return false
	}
	ctx := r.Context()
	sub := "/" + res.m.Rest
	var api *registry.MountAPI
	if res.m.Mount.API != nil {
		eff := res.m.Mount.API.WithDefaults()
		api = &eff
		if !registry.UnderPrefix(sub, api.Prefix) {
			return false // not an API path of this mount: pages and the shell answer
		}
	}
	a, route, ok := s.A.MatchRoute(ctx, res.store, r.Method, sub, api)
	if !ok {
		if api != nil {
			// Below an API prefix the path space is the API's: an
			// unknown or disallowed route is a JSON 404, never the page.
			writeJSONError(w, 404, "not_found", "no route "+r.Method+" "+sub+" on this API")
			return true
		}
		return false
	}
	vis := s.A.VisitorOf(ctx, p, res.store)
	need, audiences := route.Level, []string{}
	if route.Audience != "" {
		audiences = append(audiences, route.Audience)
	}
	if api != nil {
		f := api.FloorOf(route.Key)
		need = registry.MaxLevel(need, f.Min)
		if f.Audience != "" {
			audiences = append(audiences, f.Audience)
		}
	}
	if need != "public" {
		want, ok := rt.ParseLevel(need)
		have, _ := rt.ParseLevel(vis.Level)
		if !ok || have < want {
			if have == rt.LevelNone {
				notFound(w)
			} else {
				writeJSONError(w, 403, "permission_denied", "this needs "+need)
			}
			return true
		}
	}
	for _, aud := range audiences {
		if !access.Audience(vis.Audience).In(access.Group(aud)) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(403)
			_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "audience_required", "audience": aud}})
			return true
		}
	}
	limit, forward := int64(actorRouteBodyLimit), registry.DefaultForwardHeaders
	if api != nil {
		limit, forward = api.MaxBodyBytes, api.ForwardHeaders
	}
	// Read one byte past the limit: a longer body is refused, not cut.
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		writeJSONError(w, 400, "invalid_argument", "the request body could not be read")
		return true
	}
	if int64(len(body)) > limit {
		writeJSONError(w, 413, "payload_too_large", fmt.Sprintf("the body is limited to %d bytes", limit))
		return true
	}
	req := actor.Req{Method: r.Method, Path: sub, Base: res.m.Base, Query: map[string]string{}, Headers: map[string]string{}, Body: string(body)}
	for k := range r.URL.Query() {
		req.Query[k] = r.URL.Query().Get(k)
	}
	for _, h := range forward {
		if v := r.Header.Get(h); v != "" {
			req.Headers[strings.ToLower(h)] = v
		}
	}
	out, err := s.A.Serve(ctx, a, route, req, vis)
	if err != nil {
		var ae *actor.Error
		code, msg := "actor_error", err.Error()
		if errors.As(err, &ae) {
			code, msg = ae.Code, ae.Message
		}
		status := 500
		switch code {
		case "permission_denied", "audience_required":
			status = 403
		case "not_found":
			status = 404
		case "invalid_argument":
			status = 400
		}
		writeJSONError(w, status, code, msg)
		return true
	}
	if out.Asset != nil {
		var allow func(string) bool
		if api != nil {
			allow = func(t string) bool { return responseTypeAllowed(api, t) }
		}
		s.serveBoundAsset(w, r, res.store, out.Asset, out.Headers["Cache-Control"], allow)
		return true
	}
	ctype := out.Type
	for k, v := range out.Headers {
		if http.CanonicalHeaderKey(k) == "Content-Type" {
			ctype = v
		}
	}
	html := false
	if api != nil {
		// The response policy: a type the mount allows, only allowlisted
		// headers, a bounded size, and HTML sandboxed.
		if (ctype != "" || len(out.Body) > 0) && !responseTypeAllowed(api, ctype) {
			writeJSONError(w, 500, "response_type_not_allowed", fmt.Sprintf("this mount's API answers %s, not %q", strings.Join(api.ResponseTypes, ", "), ctype))
			return true
		}
		if int64(len(out.Body)) > api.MaxResponseBytes {
			writeJSONError(w, 500, "response_too_large", fmt.Sprintf("this mount's API answers at most %d bytes", api.MaxResponseBytes))
			return true
		}
		mt, _, _ := mime.ParseMediaType(ctype)
		html = mt == "text/html"
	}
	for k, v := range out.Headers {
		if api != nil && !apiResponseHeaders[http.CanonicalHeaderKey(k)] {
			continue
		}
		w.Header().Set(k, v)
	}
	if w.Header().Get("Content-Type") == "" && out.Type != "" {
		w.Header().Set("Content-Type", out.Type)
	}
	if html {
		w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	}
	if cc := w.Header().Get("Cache-Control"); cc == "" {
		w.Header().Set("Cache-Control", "no-store")
	} else if (strings.Contains(cc, "public") || strings.Contains(cc, "s-maxage")) && s.visibilityOf(r.Context(), res.store) != public {
		// a shared cache may keep a response only if anyone may read the store
		w.Header().Set("Cache-Control", cachePrivate)
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(out.Status)
	_, _ = w.Write(out.Body)
	return true
}

// responseTypeAllowed reports whether a Content-Type's media type is one
// the mount's API answers.
func responseTypeAllowed(api *registry.MountAPI, ctype string) bool {
	mt, _, err := mime.ParseMediaType(ctype)
	return err == nil && slices.Contains(api.ResponseTypes, strings.ToLower(mt))
}

// serveBoundAsset sends an uploaded file of a store bound to storeID with
// uploads, rechecking the binding and the store's read: the actor names
// the file, the server sends it, so no bytes pass through JavaScript.
// Like /_blob/ on a sandbox origin, the file is never a page here (a
// sandboxing CSP), and anything but media is a download.
func (s *Door) serveBoundAsset(w http.ResponseWriter, r *http.Request, storeID string, ref *actor.AssetRef, cache string, allow func(ctype string) bool) {
	ctx := r.Context()
	b, err := s.Registry.BindingOf(ctx, storeID, ref.From)
	if err != nil || !b.Assets {
		notFound(w)
		return
	}
	me := &access.Principal{Kind: access.KindStore, Store: storeID}
	st, d, err := s.K.Open(ctx, me, b.Target, rt.LevelView, "reading", true)
	if err != nil || !d.OK {
		notFound(w)
		return
	}
	f, err := st.File(ctx, "assets", ref.ID)
	if err != nil {
		notFound(w)
		return
	}
	if allow != nil && !allow(f.Type) {
		writeJSONError(w, 500, "response_type_not_allowed", fmt.Sprintf("this mount's API does not answer %q", f.Type))
		return
	}
	// The actor may ask for public caching (its Cache-Control); a shared
	// cache may keep the upload only if anyone could reach this store too.
	out := storeBytes{st: st, f: f, vis: private, mut: moving}
	if strings.Contains(cache, "public") && s.visibilityOf(ctx, storeID) == public {
		out.vis = public
		if strings.Contains(cache, "immutable") {
			out.mut = immutable
		}
	}
	s.writeStoreBytes(w, r, out)
}

func isMedia(t string) bool {
	for _, p := range []string{"image/", "video/", "audio/", "application/pdf"} {
		if strings.HasPrefix(t, p) {
			return true
		}
	}
	return false
}

func writeJSONError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
