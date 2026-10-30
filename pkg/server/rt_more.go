package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/httpx"
	"github.com/go-go-golems/slop-computer/pkg/rt"
	"github.com/go-go-golems/slop-computer/pkg/store"
	"github.com/pkg/errors"
)

// --- room --------------------------------------------------------------

var (
	topicName = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,47}$`)
	roomName  = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,47}$`)
)

// roomsOf lists the rooms a view is in: the lobby and the named rooms it
// joined.
func (s *Server) roomsOf(v *rt.View) []string {
	s.roomMu.Lock()
	names := append([]string{""}, s.joined[v.ID]...)
	s.roomMu.Unlock()
	var out []string
	for _, name := range names {
		if v.In(name) {
			out = append(out, name)
		}
	}
	return out
}

// peersOf is everyone in a room of a target, as one peers event.
func (s *Server) peersOf(target, room string) map[string]any {
	peers := []rt.Peer{}
	for _, o := range s.views.Of(target) {
		if p, ok := o.AsPeer(room); ok {
			peers = append(peers, p)
		}
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].Peer < peers[j].Peer })
	return map[string]any{"room": room, "peers": peers}
}

// announce sends a room's peers to everyone in it.
func (s *Server) announce(target, room string) {
	ev := rt.Out{Type: "peers", Data: s.peersOf(target, room)}
	for _, o := range s.views.Of(target) {
		if o.In(room) {
			o.Send(ev)
		}
	}
}

// roomClosed runs when a view closes: the rooms it was in hear it left.
func (s *Server) roomClosed(v *rt.View, rooms []string) {
	s.roomMu.Lock()
	delete(s.joined, v.ID)
	s.roomMu.Unlock()
	for _, room := range rooms {
		s.announce(v.Target, room)
	}
}

type roomArgs struct {
	Room  string          `json:"room"`
	Topic string          `json:"topic"`
	Data  json.RawMessage `json:"data"`
	Patch map[string]any  `json:"patch"`
}

func (s *Server) rpcRoomJoin(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if a.Room != "" && !roomName.MatchString(a.Room) {
		return nil, rtErr("invalid_argument", "a room name matches %s", roomName)
	}
	if !v.Join(a.Room) {
		return nil, rtErr("limit_reached", "at most %d rooms", rt.MaxRooms)
	}
	if a.Room != "" {
		s.roomMu.Lock()
		if !slices.Contains(s.joined[v.ID], a.Room) {
			s.joined[v.ID] = append(s.joined[v.ID], a.Room)
		}
		s.roomMu.Unlock()
	}
	s.announce(v.Target, a.Room)
	return s.peersOf(v.Target, a.Room), nil
}

func (s *Server) rpcRoomLeave(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if v.Leave(a.Room) {
		s.roomMu.Lock()
		s.joined[v.ID] = slices.DeleteFunc(s.joined[v.ID], func(n string) bool { return n == a.Room })
		s.roomMu.Unlock()
		s.announce(v.Target, a.Room)
	}
	return map[string]bool{"ok": true}, nil
}

func (s *Server) rpcRoomPresence(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if !v.In(a.Room) {
		v.Join(a.Room)
	}
	if err := v.SetPresence(a.Room, a.Patch); err != nil {
		return nil, rtErr("invalid_argument", "%v", err)
	}
	s.announce(v.Target, a.Room)
	return map[string]bool{"ok": true}, nil
}

func (s *Server) rpcRoomEmit(_ context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[roomArgs](raw)
	if err != nil {
		return nil, err
	}
	if !topicName.MatchString(a.Topic) {
		return nil, rtErr("invalid_argument", "a topic matches %s", topicName)
	}
	if len(a.Data) > rt.MaxRoomData {
		return nil, rtErr("invalid_argument", "data is at most %d bytes of JSON", rt.MaxRoomData)
	}
	need := rt.LevelAdmin
	if l, ok := v.Caps.Topics[a.Topic]; ok {
		need = l
	}
	if v.Level < need {
		return nil, rtErr("not_permitted", "topic %q needs %s", a.Topic, need)
	}
	if !v.In(a.Room) {
		return nil, rtErr("invalid_argument", "not in room %q", a.Room)
	}
	if !v.AllowEmit(time.Now()) {
		return map[string]bool{"dropped": true}, nil
	}
	var by *string
	if v.Caps.Declared["user"] && v.User != "" {
		u := v.User
		by = &u
	}
	data := a.Data
	if len(data) == 0 {
		data = json.RawMessage("null")
	}
	ev := rt.Out{Type: "room", Data: map[string]any{"room": a.Room, "topic": a.Topic, "data": data, "peer": v.ID, "by": by, "kind": v.Kind, "guest": false}}
	for _, o := range s.views.Of(v.Target) {
		if o.In(a.Room) {
			o.Send(ev)
		}
	}
	return map[string]bool{"ok": true}, nil
}

// agentWaiting reports whether an agent waits (slop comments wait) on the
// view's target, its app or their project.
func (s *Server) agentWaiting(ctx context.Context, v *rt.View) bool {
	proj := s.projectOf(ctx, v.Target)
	for _, w := range s.waiters.list() {
		if w.Artifact == v.Target || w.Artifact == v.App || (w.Artifact == "" && (w.Project == "" || w.Project == proj)) {
			return true
		}
	}
	return false
}

func (s *Server) rpcCanSendToClaudeSession(ctx context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	if s.agentWaiting(ctx, v) {
		return "available", nil
	}
	return "no_session", nil
}

// claudeThread hands something to an agent: a thread on the app version,
// anchored {"claude": true, "target", "data"}, that `slop comments wait`
// returns.
func (s *Server) claudeThread(ctx context.Context, v *rt.View, anchor map[string]any, text string) (store.Thread, error) {
	anchor["claude"], anchor["target"] = true, v.Target
	raw, err := json.Marshal(anchor)
	if err != nil {
		return store.Thread{}, err
	}
	t, evs, err := s.Store.CreateThread(ctx, v.App, v.Version, store.JSON(raw), text, v.User, "", false)
	if err != nil {
		return t, err
	}
	s.publish(evs)
	return t, nil
}

func (s *Server) rpcSendToClaudeSession(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		Data    map[string]any `json:"data"`
		Deliver string         `json:"deliver"`
	}](raw)
	if err != nil {
		return nil, err
	}
	enc, _ := json.Marshal(a.Data)
	if len(a.Data) == 0 || len(enc) > rt.MaxSendToClaude || rt.Depth(a.Data) > 8 {
		return nil, rtErr("invalid_argument", "data is a non-empty object of at most %d bytes and 8 levels", rt.MaxSendToClaude)
	}
	if !s.agentWaiting(ctx, v) {
		return nil, rtErr("claude_unavailable", "no agent is waiting on this artifact (slop comments wait)")
	}
	label, _ := a.Data["label"].(string)
	if label == "" {
		label = "From " + v.App
	}
	t, err := s.claudeThread(ctx, v, map[string]any{"data": json.RawMessage(enc), "deliver": a.Deliver}, label+"\n\n"+string(enc))
	if err != nil {
		return nil, err
	}
	return map[string]any{"to": "session", "id": t.ID}, nil
}

// --- comments ----------------------------------------------------------

type commentArgs struct {
	Anchor   json.RawMessage `json:"anchor"`
	Text     string          `json:"text"`
	Thread   string          `json:"thread"`
	Resolved *bool           `json:"resolved"`
}

func (s *Server) commentsWrite(ctx context.Context, v *rt.View) error {
	if v.Caps.Composer {
		return rtErr("not_granted", "this page may only open the composer")
	}
	return s.needConsent(ctx, v, "comments")
}

func (s *Server) rpcCommentsCreate(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[commentArgs](raw)
	if err != nil {
		return nil, err
	}
	if err := s.commentsWrite(ctx, v); err != nil {
		return nil, err
	}
	if len(a.Text) > rt.MaxCommentBytes {
		return nil, rtErr("invalid_argument", "a comment is at most %d bytes", rt.MaxCommentBytes)
	}
	t, evs, err := s.Store.CreateThread(ctx, v.App, v.Version, store.JSON(a.Anchor), a.Text, v.User, "", false)
	if err != nil {
		return nil, rtErr("invalid_argument", "%v", err)
	}
	s.publish(evs)
	return t, nil
}

// threadOf finds a thread of the view's app.
func (s *Server) threadOf(ctx context.Context, v *rt.View, id string) (store.Thread, error) {
	t, err := s.Store.Thread(ctx, id)
	if err != nil || t.Artifact != v.App {
		return t, rtErr("invalid_argument", "no thread %q here", id)
	}
	return t, nil
}

func (s *Server) rpcCommentsReply(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[commentArgs](raw)
	if err != nil {
		return nil, err
	}
	if err := s.commentsWrite(ctx, v); err != nil {
		return nil, err
	}
	if _, err := s.threadOf(ctx, v, a.Thread); err != nil {
		return nil, err
	}
	_, c, evs, err := s.Store.Reply(ctx, a.Thread, a.Text, nil, v.User, "", false)
	if err != nil {
		return nil, rtErr("invalid_argument", "%v", err)
	}
	s.publish(evs)
	return c, nil
}

func (s *Server) rpcCommentsResolve(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[commentArgs](raw)
	if err != nil {
		return nil, err
	}
	if err := s.commentsWrite(ctx, v); err != nil {
		return nil, err
	}
	if _, err := s.threadOf(ctx, v, a.Thread); err != nil {
		return nil, err
	}
	resolved := a.Resolved == nil || *a.Resolved
	t, evs, err := s.Store.ResolveThread(ctx, a.Thread, resolved, v.User)
	if err != nil {
		return nil, err
	}
	s.publish(evs)
	return t, nil
}

func (s *Server) rpcCommentsSendToClaude(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[commentArgs](raw)
	if err != nil {
		return nil, err
	}
	if err := s.commentsWrite(ctx, v); err != nil {
		return nil, err
	}
	if a.Thread != "" {
		if _, err := s.threadOf(ctx, v, a.Thread); err != nil {
			return nil, err
		}
		_, c, evs, err := s.Store.Reply(ctx, a.Thread, a.Text, nil, v.User, "", false)
		if err != nil {
			return nil, rtErr("invalid_argument", "%v", err)
		}
		s.publish(evs)
		return map[string]any{"thread": a.Thread, "comment": c.ID}, nil
	}
	anchor := map[string]any{}
	_ = json.Unmarshal(a.Anchor, &anchor)
	t, err := s.claudeThread(ctx, v, anchor, a.Text)
	if err != nil {
		return nil, rtErr("invalid_argument", "%v", err)
	}
	return map[string]any{"thread": t.ID}, nil
}

// --- assets ------------------------------------------------------------

// assetTypes are the content types an upload may have.
var assetTypes = map[string]bool{
	"image/png": true, "image/jpeg": true, "image/gif": true, "image/webp": true, "image/avif": true,
	"video/mp4": true, "video/webm": true, "application/pdf": true,
	"font/woff": true, "font/woff2": true, "font/ttf": true, "font/otf": true,
	"text/css": true, "text/javascript": true, "application/javascript": true,
	"text/csv": true, "text/markdown": true, "application/json": true, "text/plain": true,
}

// uploadAsset takes a raw body on the target origin: POST /_rt/assets.
func (s *Server) uploadAsset(w http.ResponseWriter, r *http.Request) {
	v := s.viewOf(r)
	if v == nil {
		httpx.Fail(w, 401, "revoked", "The view is closed or expired")
		return
	}
	if _, ok := grantedCaps(v)["assets"]; !ok {
		httpx.Fail(w, 403, "not_granted", "This view was not granted assets")
		return
	}
	ct := strings.TrimSpace(strings.SplitN(r.Header.Get("Content-Type"), ";", 2)[0])
	if !assetTypes[ct] {
		httpx.Fail(w, 415, "unsupported_type", "Unsupported content type "+ct)
		return
	}
	limit := int64(rt.MaxAssetBytes)
	if ct == "text/css" || strings.HasSuffix(ct, "javascript") {
		limit = rt.MaxCodeAssetBytes
	}
	sum, n, err := s.Blobs.PutReader(io.LimitReader(r.Body, limit+1), limit, "")
	if err != nil {
		httpx.Fail(w, 413, "too_large", "An asset is at most 20 MiB (CSS and JS 16 MiB)")
		return
	}
	a, err := s.Store.RTAddAsset(r.Context(), store.RTAsset{Target: v.Target, SHA256: sum, ContentType: ct, Size: n, CreatedBy: v.User})
	if err != nil {
		unavailable(w, err)
		return
	}
	httpx.OK(w, map[string]any{"id": a.ID, "url": "/_blob/" + a.ID, "sizeBytes": a.Size, "contentType": a.ContentType})
}

// serveAsset serves /_blob/{id} on the target's origin: bytes, never a page.
func (s *Server) serveAsset(w http.ResponseWriter, r *http.Request, target, id string) {
	a, err := s.Store.RTAsset(r.Context(), target, id)
	if err != nil {
		notFoundPage(w)
		return
	}
	v, err := s.variant(r, store.FileEntry{SHA256: a.SHA256, Type: a.ContentType, Size: a.Size}) // ?w=, gzip
	if err != nil {
		unavailable(w, err)
		return
	}
	defer func() { _ = v.Close() }()
	h := w.Header()
	h.Set("Content-Type", v.Type)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox; default-src 'none'")
	// Revalidated on every use (a cheap 304 by ETag): a deleted asset is
	// gone for good, not served from the browser's cache.
	h.Set("Cache-Control", "private, no-cache")
	h.Set("ETag", `"`+v.Tag+`"`)
	if v.Encoding != "" {
		h.Set("Content-Encoding", v.Encoding)
	}
	if compressible(a.ContentType) {
		h.Add("Vary", "Accept-Encoding")
	}
	http.ServeContent(w, r, "", zeroTime, v)
}

func (s *Server) rpcAssetsList(ctx context.Context, v *rt.View, _ json.RawMessage) (any, error) {
	as, err := s.Store.RTAssets(ctx, v.Target)
	if err != nil {
		return nil, err
	}
	var used int64
	out := make([]map[string]any, 0, len(as))
	for _, a := range as {
		used += a.Size
		out = append(out, map[string]any{"id": a.ID, "url": "/_blob/" + a.ID, "sizeBytes": a.Size, "contentType": a.ContentType, "createdAt": a.CreatedAt})
	}
	return map[string]any{"assets": out, "usage": map[string]any{"bytes": used, "count": len(as)}}, nil
}

func (s *Server) rpcAssetsDelete(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct{ ID string }](raw)
	if err != nil {
		return nil, err
	}
	ok, err := s.Store.RTDeleteAsset(ctx, v.Target, a.ID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, rtErr("not_found", "no asset %q", a.ID)
	}
	return map[string]bool{"deleted": true}, nil
}

// --- artifact.publish --------------------------------------------------

// rpcArtifactPublish saves a new version of the app (the target is the app
// itself): index.html replaced, the other files kept, main moved, every view
// reloaded.
func (s *Server) rpcArtifactPublish(ctx context.Context, v *rt.View, raw json.RawMessage) (any, error) {
	a, err := args[struct {
		HTML string `json:"html"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if v.Level < rt.LevelAdmin || v.Role != store.RoleAdmin {
		return nil, rtErr("not_writer", "only editors publish")
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(a.HTML)), "<!doctype") {
		return nil, rtErr("invalid_content", "publish a complete document, doctype first")
	}
	if len(a.HTML) > 16<<20 {
		return nil, rtErr("too_large", "a page is at most 16 MiB")
	}
	cur, err := s.Store.Version(ctx, v.App, v.Version)
	if err != nil {
		return nil, err
	}
	sum, err := s.Blobs.Put([]byte(a.HTML))
	if err != nil {
		return nil, err
	}
	tree := map[string]store.FileEntry{}
	for p, f := range cur.Files {
		tree[p] = f
	}
	tree["index.html"] = store.FileEntry{SHA256: sum, Size: int64(len(a.HTML)), Type: "text/html; charset=utf-8"}
	base := v.Version
	res, err := s.Store.Push(ctx, store.PushInput{Artifact: v.App, Base: &base, Tree: tree, Manifest: cur.Manifest,
		Message: "published from the page", Via: "app", MoveMain: true, Actor: v.User})
	var moved *store.MainMovedError
	if errors.As(err, &moved) {
		return nil, rtErr("conflict", "a newer version was published")
	}
	if err != nil {
		return nil, err
	}
	s.publish(res.Events)
	for _, o := range s.views.Of(v.Target) {
		o.Send(rt.Out{Type: "reload", Data: map[string]int{"version": res.Version.N}})
	}
	return map[string]any{"version": res.Version.N}, nil
}

// --- agents ------------------------------------------------------------

// agentDB is the ArtifactData surface for tokens: one POST with an op, the
// same store functions and events as views. as_level lets an agent test
// rules as a lower level; data/users/me names the token's user.
func (s *Server) agentDB(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var in struct {
		Op         string            `json:"op"` // get list query set update str_replace delete batch
		Path       string            `json:"path"`
		Collection string            `json:"collection"`
		Data       json.RawMessage   `json:"data"`
		Query      *rt.Query         `json:"query"`
		Field      string            `json:"field"`
		Old        string            `json:"old"`
		New        string            `json:"new"`
		IfVersion  *int64            `json:"if_version"`
		AsLevel    string            `json:"as_level"`
		Limit      int               `json:"limit"`
		Cursor     string            `json:"cursor"`
		Ops        []json.RawMessage `json:"ops"`
	}
	if err := httpx.Read(w, r, &in, 8<<20); err != nil {
		httpx.Fail(w, 400, "invalid_request", "Send {op, path|collection, …}")
		return
	}
	p := principal(ctx)
	reads := in.Op == "get" || in.Op == "list" || in.Op == "query"
	if p.Token != nil {
		need := store.ScopeWrite
		if reads {
			need = store.ScopeRead
		}
		if !p.Token.Allows(need) {
			httpx.Fail(w, 403, "token_scope", "This token lacks the "+need+" scope")
			return
		}
	}
	t, caps, _, err := s.rtTarget(ctx, r.PathValue("t"), 0)
	if err != nil {
		s.rtHTTPFail(w, err)
		return
	}
	u := me(r)
	wr := writer{user: u.ID, level: s.levelOf(ctx, u, t), rules: caps.Rules}
	if in.AsLevel != "" {
		l, ok := rt.ParseLevel(in.AsLevel)
		if !ok || l > wr.level || l == rt.LevelSelf {
			httpx.Fail(w, 400, "invalid_request", "as_level is view, interact, admin or owner, at most your own")
			return
		}
		wr.level = l
	}
	me := func(path string) string {
		if rest, ok := strings.CutPrefix(path, "data/users/me"); ok && (rest == "" || rest[0] == '/') {
			return "data/users/" + u.ID + rest
		}
		return path
	}
	in.Path, in.Collection = me(in.Path), me(in.Collection)
	var out any
	switch in.Op {
	case "get":
		out, err = s.dbGet(ctx, t.ID, wr, in.Path)
	case "list", "query":
		q := rt.Query{Coll: in.Collection, Limit: in.Limit}
		if in.Query != nil {
			q = *in.Query
			q.Coll = in.Collection
		}
		if q.Limit == 0 {
			q.Limit = 100
		}
		out, err = s.dbQuery(ctx, t.ID, wr, q)
	case "set", "update", "delete":
		var ch store.RTChange
		ch, err = s.dbWrite(ctx, t.ID, wr, writeIn{Path: in.Path, Op: in.Op, Body: in.Data, IfVersion: in.IfVersion})
		out = map[string]any{"path": in.Path, "version": ch.Version, "rev": ch.Rev}
	case "str_replace":
		out, err = s.agentStrReplace(ctx, t.ID, wr, in.Path, in.Field, in.Old, in.New, in.IfVersion)
	case "batch":
		if len(in.Ops) > 50 {
			httpx.Fail(w, 400, "invalid_request", "a batch has at most 50 writes")
			return
		}
		results := []any{}
		for _, raw := range in.Ops {
			var op writeIn
			var data struct {
				Data json.RawMessage `json:"data"`
				If   *int64          `json:"if_version"`
			}
			if json.Unmarshal(raw, &op) != nil || json.Unmarshal(raw, &data) != nil {
				err = rtErr("invalid_argument", "a batch op is {op, path, data?, if_version?}")
				break
			}
			op.Path, op.Body, op.IfVersion = me(op.Path), data.Data, data.If
			ch, werr := s.dbWrite(ctx, t.ID, wr, op)
			if werr != nil {
				err = werr
				break
			}
			results = append(results, map[string]any{"path": op.Path, "version": ch.Version})
		}
		out = map[string]any{"results": results}
	default:
		httpx.Fail(w, 400, "invalid_request", "op is get, list, query, set, update, str_replace, delete or batch")
		return
	}
	if err != nil {
		s.rtHTTPFail(w, err)
		return
	}
	httpx.OK(w, out)
}

// agentStrReplace replaces one occurrence of old in a string field.
func (s *Server) agentStrReplace(ctx context.Context, target string, wr writer, path, field, old, nw string, ifVersion *int64) (any, error) {
	d, err := s.Store.RTDoc(ctx, target, path)
	if err != nil {
		return nil, rtErr("invalid_argument", "no document at %q", path)
	}
	var body map[string]any
	if err := json.Unmarshal(d.Body, &body); err != nil {
		return nil, err
	}
	cur, ok := body[field].(string)
	if !ok || strings.Count(cur, old) != 1 {
		return nil, rtErr("invalid_argument", "field %q must hold old exactly once", field)
	}
	body[field] = strings.Replace(cur, old, nw, 1)
	raw, _ := json.Marshal(body)
	v := d.Version
	if ifVersion != nil {
		v = *ifVersion
	}
	ch, err := s.dbWrite(ctx, target, wr, writeIn{Path: path, Op: "set", Body: raw, IfVersion: &v})
	if err != nil {
		return nil, err
	}
	return map[string]any{"path": path, "version": ch.Version}, nil
}

// --- apps --------------------------------------------------------------

type appOut struct {
	Artifact    string            `json:"artifact"`
	Title       string            `json:"title"`
	Project     *string           `json:"project"`
	Main        int               `json:"main"`
	Latest      int               `json:"latest"`
	Caps        []string          `json:"caps"`
	Permissions []string          `json:"permissions"`
	Approved    *store.RTApproval `json:"approved"`
	Targets     []string          `json:"targets"`
	Error       string            `json:"error,omitempty"`
	Labels      map[string]string `json:"labels"`
}

// listApps lists pages whose main declares capabilities, the slop
// permissions main asks for, whether main is approved, and their targets.
func (s *Server) listApps(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	arts, err := s.Store.Artifacts(ctx, "")
	if err != nil {
		unavailable(w, err)
		return
	}
	targets := map[string][]string{}
	for _, a := range arts {
		if a.App != "" {
			targets[a.App] = append(targets[a.App], a.ID)
		}
	}
	out := []appOut{}
	for _, a := range arts {
		if a.Kind != store.KindPage || a.Main == 0 {
			continue
		}
		caps, _, err := s.appCaps(ctx, a.ID, a.Main)
		if err == nil && !caps.IsApp() {
			continue
		}
		o := appOut{Artifact: a.ID, Title: a.Title, Project: a.Project, Main: a.Main, Latest: a.Latest, Caps: []string{},
			Permissions: caps.Permission, Targets: targets[a.ID], Labels: rt.SlopPermissions}
		if err != nil {
			o.Error = err.Error()
		}
		for name := range caps.Declared {
			o.Caps = append(o.Caps, name)
		}
		sort.Strings(o.Caps)
		if ap, err := s.Store.RTApprovalOf(ctx, a.ID, a.Main); err == nil {
			o.Approved = &ap
		}
		out = append(out, o)
	}
	httpx.OK(w, out)
}

// approveApp approves the slop permissions an app version asks for. Only a
// browser session can approve: no token, no app. The request names the
// permissions the admin was shown, and they must be exactly the version's.
func (s *Server) approveApp(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version     int      `json:"version"`
		Permissions []string `json:"permissions"`
	}
	if err := httpx.Read(w, r, &in, 4<<10); err != nil || in.Permissions == nil {
		httpx.Fail(w, 400, "invalid_request", "Send {version, permissions}")
		return
	}
	id := r.PathValue("id")
	caps, v, err := s.appCaps(r.Context(), id, in.Version)
	if err != nil {
		s.fail(w, err)
		return
	}
	shown := slices.Clone(in.Permissions)
	slices.Sort(shown)
	asked := slices.Clone(caps.Permission)
	slices.Sort(asked)
	if !slices.Equal(slices.Compact(shown), slices.Compact(asked)) {
		httpx.Fail(w, 409, "conflict", fmt.Sprintf("Version %d asks for other permissions than those shown; reopen it and review them again", v.N))
		return
	}
	a, err := s.Store.RTApprove(r.Context(), id, v.N, caps.Permission, actor(r))
	if err != nil {
		unavailable(w, err)
		return
	}
	_ = s.Store.Audit(r.Context(), actor(r), "app.approve", id, map[string]any{"version": v.N, "permissions": caps.Permission})
	httpx.OK(w, a)
}
