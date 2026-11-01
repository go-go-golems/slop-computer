package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-go-golems/slop/pkg/access"
	"github.com/go-go-golems/slop/pkg/actor"
	"github.com/go-go-golems/slop/pkg/rt"
)

// actorEmit sends an actor's room message to the store's views (after the
// actor's turn committed).
func (s *Server) actorEmit(storeID, topic string, data any) {
	raw, _ := json.Marshal(data)
	ev := rt.Out{Type: "room", Data: map[string]any{"room": "", "topic": topic, "data": json.RawMessage(raw), "peer": "actor",
		"by": "store:" + storeID, "kind": "actor", "guest": false}}
	for _, v := range s.rt.views.Of(storeID) {
		if v.In("") {
			v.Send(ev)
		}
	}
}

// viewPrincipal rebuilds the principal of a view's person.
func (s *Server) viewPrincipal(ctx context.Context, v *rt.View) *access.Principal {
	if v.User == "" {
		return nil
	}
	p, err := s.Sys.Person(ctx, v.User)
	if err != nil {
		return nil
	}
	kind := access.KindUser
	if p.Kind == "guest" {
		kind = access.KindGuest
	}
	return &access.Principal{Kind: kind, Person: &p, Via: "page"}
}

func actorFail(err error) error {
	var ae *actor.Error
	if errors.As(err, &ae) {
		return rtErr(ae.Code, "%s", ae.Message)
	}
	return err
}

// rpcSlopCall calls an action of the store's actor as the viewer.
func (s *Server) rpcSlopCall(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
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
	vis := s.Env.A.VisitorOf(ctx, s.viewPrincipal(ctx, v), v.Target)
	out, err := s.Env.A.Call(ctx, v.Target, a.Action, in, vis, "page")
	return out, actorFail(err)
}

// rpcSlopRead reads an aliased store, by the viewer's own level there.
func (s *Server) rpcSlopRead(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
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
	target, err := s.Sys.Binding(ctx, v.Target, a.Alias)
	if err != nil {
		return nil, rtErr("not_found", "no store is bound to %q", a.Alias)
	}
	p := s.viewPrincipal(ctx, v)
	d, _, err := s.Env.K.Access.Can(ctx, p, target, rt.LevelView, "reading", true)
	if err != nil {
		return nil, err
	}
	if !d.OK {
		return nil, rtErr("not_found", "nothing to read at %q", a.Alias)
	}
	st, err := s.Env.K.Store(ctx, target)
	if err != nil {
		return nil, err
	}
	rules := s.Env.K.Rules(ctx, target)
	switch a.Op {
	case "get":
		if !rules.CanRead(a.Path, p.ID(), d.Level) {
			return map[string]any{"path": a.Path, "exists": false}, nil
		}
		doc, err := st.GetDoc(ctx, a.Path)
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
		docs, err := st.Query(ctx, q)
		if err != nil {
			return nil, rtErr("invalid_argument", "invalid query on %q", a.Coll)
		}
		out := []map[string]any{}
		for _, doc := range docs {
			if rules.CanRead(doc.Path, p.ID(), d.Level) {
				out = append(out, docResult(doc))
			}
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

// serveActorRoute answers a request on a mount from the store's actor when
// one of its http routes matches. It reports whether it answered.
func (s *Server) serveActorRoute(w http.ResponseWriter, r *http.Request, res *resolved, p *access.Principal) bool {
	if s.Env.A == nil || res.run.Manifest == nil || res.run.Manifest.Actor == "" {
		return false
	}
	ctx := r.Context()
	sub := "/" + res.m.Rest
	a, route, ok := s.Env.A.MatchRoute(ctx, res.store, r.Method, sub)
	if !ok {
		return false
	}
	vis := s.Env.A.VisitorOf(ctx, p, res.store)
	if route.Level != "public" {
		need, ok := rt.ParseLevel(route.Level)
		have, _ := rt.ParseLevel(vis.Level)
		if !ok || have < need {
			if have == rt.LevelNone {
				notFound(w)
			} else {
				writeJSONError(w, 403, "permission_denied", "this needs "+route.Level)
			}
			return true
		}
	}
	if route.Audience != "" && !access.Audience(vis.Audience).AtLeast(access.Audience(route.Audience)) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(403)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"code": "audience_required", "audience": route.Audience}})
		return true
	}
	body, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	req := actor.Req{Method: r.Method, Path: sub, Query: map[string]string{}, Headers: map[string]string{}, Body: string(body)}
	for k := range r.URL.Query() {
		req.Query[k] = r.URL.Query().Get(k)
	}
	for _, h := range []string{"Content-Type", "Accept", "User-Agent", "Referer"} {
		if v := r.Header.Get(h); v != "" {
			req.Headers[strings.ToLower(h)] = v
		}
	}
	out, err := s.Env.A.Serve(ctx, a, route, req, vis)
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
	for k, v := range out.Headers {
		w.Header().Set(k, v)
	}
	if w.Header().Get("Content-Type") == "" && out.Type != "" {
		w.Header().Set("Content-Type", out.Type)
	}
	if w.Header().Get("Cache-Control") == "" {
		w.Header().Set("Cache-Control", "no-store")
	}
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(out.Status)
	_, _ = w.Write(out.Body)
	return true
}

func writeJSONError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
