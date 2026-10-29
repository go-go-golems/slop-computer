package server

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// sseEvent is one event of a view stream.
type sseEvent struct {
	Type string
	Data map[string]any
}

// viewClient is a page's runtime in a test: its target origin and secret.
type viewClient struct {
	h      *harness
	host   string
	secret string
	id     string
	events chan sseEvent
}

func (h *harness) openView(b *browser, target string) *viewClient {
	h.t.Helper()
	var v map[string]any
	if code := b.do("POST", "/api/rt/views", map[string]any{"target": target}, &v); code != 200 {
		h.t.Fatalf("open view %s: %d %v", target, code, v)
	}
	u, _ := url.Parse(v["url"].(string))
	return &viewClient{h: h, host: u.Host, secret: v["secret"].(string), id: v["view"].(string)}
}

func (vc *viewClient) req(method, path string, body io.Reader) *http.Request {
	req, _ := http.NewRequest(method, vc.h.ts.URL+path, body)
	req.Host = vc.host
	req.Header.Set("Authorization", "Bearer "+vc.secret)
	return req
}

// stream connects the view's stream and returns once hello arrived.
func (vc *viewClient) stream() map[string]any {
	vc.h.t.Helper()
	resp, err := http.DefaultClient.Do(vc.req("GET", "/_rt/events", nil))
	if err != nil || resp.StatusCode != 200 {
		vc.h.t.Fatalf("stream: %v %v", err, resp)
	}
	vc.h.t.Cleanup(func() { _ = resp.Body.Close() })
	vc.events = make(chan sseEvent, 64)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		typ, data := "", ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				typ = line[7:]
			case strings.HasPrefix(line, "data: "):
				data += line[6:]
			case line == "" && typ != "":
				ev := sseEvent{Type: typ}
				_ = json.Unmarshal([]byte(data), &ev.Data)
				vc.events <- ev
				typ, data = "", ""
			}
		}
		close(vc.events)
	}()
	return vc.next("hello").Data
}

// next waits for the next event of a type, skipping others.
func (vc *viewClient) next(typ string) sseEvent {
	vc.h.t.Helper()
	timeout := time.After(3 * time.Second)
	for {
		select {
		case ev, ok := <-vc.events:
			if !ok {
				vc.h.t.Fatalf("stream ended waiting for %s", typ)
			}
			if ev.Type == typ {
				return ev
			}
		case <-timeout:
			vc.h.t.Fatalf("no %s event", typ)
		}
	}
}

// rpc calls a method; it returns the result, or the error code.
func (vc *viewClient) rpc(method string, args any) (map[string]any, string) {
	vc.h.t.Helper()
	raw, _ := json.Marshal(map[string]any{"method": method, "args": args})
	req := vc.req("POST", "/_rt/rpc", strings.NewReader(string(raw)))
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		vc.h.t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	var out struct {
		Result any `json:"result"`
		Error  *struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&out)
	if out.Error != nil {
		return nil, out.Error.Code
	}
	m, _ := out.Result.(map[string]any)
	return m, ""
}

func TestRuntimeViews(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	manifest := map[string]any{"capabilities": map[string]any{
		"db":   map[string]any{"rules": []any{map[string]any{"path": "notes", "write": "owner"}}},
		"user": map[string]any{"scopes": []string{"profile"}}, "room": map[string]any{},
		"slop": map[string]any{"permissions": []string{"routes:read"}},
	}}
	h.pushFiles(tok, "tracker", map[string]any{"title": "Tracker", "kind": "page"}, manifest,
		map[string]string{"index.html": "<!doctype html><html><head><title>t</title></head><body>tracker</body></html>", "app.js": "1"})
	h.pushFiles(tok, "ws1", map[string]any{"title": "Workspace", "kind": "data", "app": "tracker"}, nil, map[string]string{"readme.md": "x"})

	// An invalid manifest is refused at push.
	var res map[string]any
	if code := h.bearer(tok, "POST", "/api/artifacts/tracker/versions", map[string]any{"tree": map[string]string{},
		"manifest": map[string]any{"capabilities": map[string]any{"teleport": map[string]any{}}}, "force": true}, &res); code != 400 {
		t.Fatalf("bad manifest %d %v", code, res)
	}

	a := h.openView(manuel, "ws1")
	hello := a.stream()
	caps := hello["caps"].(map[string]any)
	if hello["target"] != "ws1" || hello["app"] != "tracker" || hello["level"] != "owner" || caps["slop"] != nil || caps["db"] == nil {
		t.Fatalf("hello %v", hello)
	}

	// The app's version on the target's origin, with the runtime first.
	code, body, _ := h.get(a.host, "/v/1/", "")
	if code != 200 || !strings.Contains(body, "/_slop/claude.js") || !strings.Contains(body, `"target":"ws1"`) || !strings.Contains(body, `"mode":"app"`) {
		t.Fatalf("app page %d %s", code, body)
	}
	if code, body, _ = h.get(a.host, "/v/1/app.js", ""); code != 200 || body != "1" {
		t.Fatalf("sibling %d %q", code, body)
	}

	// Subscribe, write, and the change arrives on the stream.
	if r, e := a.rpc("db.subscribe", map[string]any{"sub": "s1", "path": "tasks", "coll": true}); e != "" || len(r["docs"].([]any)) != 0 {
		t.Fatalf("subscribe %v %s", r, e)
	}
	if _, e := a.rpc("db.write", map[string]any{"path": "tasks/t1", "op": "set", "body": map[string]any{"title": "one", "n": 1}}); e != "" {
		t.Fatalf("set %s", e)
	}
	if ev := a.next("doc"); ev.Data["path"] != "tasks/t1" || ev.Data["version"].(float64) != 1 {
		t.Fatalf("doc event %v", ev)
	}
	if _, e := a.rpc("db.write", map[string]any{"path": "tasks/t9", "op": "update", "body": map[string]any{"x": 1}}); e != "invalid_argument" {
		t.Fatalf("update of a missing document: %q", e)
	}
	if _, e := a.rpc("db.write", map[string]any{"path": "data/users/someone/p", "op": "set", "body": map[string]any{"x": 1}}); e != "invalid_argument" {
		t.Fatalf("write into another's subtree: %q", e)
	}
	if r, _ := a.rpc("db.get", map[string]any{"path": "tasks/t9"}); r["exists"] != false {
		t.Fatalf("missing doc %v", r)
	}

	// A patch against the stored version applies; a stale base is refused.
	big := strings.Repeat("x", 2000)
	_, _ = a.rpc("db.write", map[string]any{"path": "tasks/log", "op": "set", "body": map[string]any{"ops": []any{big}}})
	a.next("doc")
	patch := map[string]any{"t": "obj", "k": map[string]any{"ops": map[string]any{"t": "arr", "s": 1, "i": []any{"y"}}}}
	if r, e := a.rpc("db.write", map[string]any{"path": "tasks/log", "op": "patch", "patch": patch, "base": 1}); e != "" || r["version"].(float64) != 2 {
		t.Fatalf("patch %v %s", r, e)
	}
	if _, e := a.rpc("db.write", map[string]any{"path": "tasks/log", "op": "patch", "patch": patch, "base": 1}); e != "conflict_base" {
		t.Fatalf("stale patch %q", e)
	}
	a.next("doc")
	// A small change to a big document travels as a patch.
	grown := map[string]any{"ops": []any{big, "y", "z"}}
	_, _ = a.rpc("db.write", map[string]any{"path": "tasks/log", "op": "set", "body": grown})
	if ev := a.next("doc"); ev.Data["patch"] == nil || ev.Data["base"].(float64) != 2 || ev.Data["body"] != nil {
		t.Fatalf("diff sync %v", ev.Data)
	}

	// An agent writes with a token; the open view sees it.
	var out map[string]any
	if code := h.bearer(tok, "POST", "/api/rt/targets/ws1/db", map[string]any{"op": "set", "path": "tasks/t2", "data": map[string]any{"title": "two"}}, &out); code != 200 {
		t.Fatalf("agent set %d %v", code, out)
	}
	if ev := a.next("doc"); ev.Data["path"] != "tasks/t2" {
		t.Fatalf("agent's doc %v", ev)
	}
	if code := h.bearer(tok, "POST", "/api/rt/targets/ws1/db", map[string]any{"op": "set", "path": "data/users/me/prefs", "data": map[string]any{"dark": true}}, &out); code != 200 {
		t.Fatalf("agent me %d %v", code, out)
	}
	if out["path"] != "data/users/"+manuel.id()+"/prefs" {
		t.Fatalf("data/users/me → %v", out)
	}
	if code := h.bearer(tok, "POST", "/api/rt/targets/ws1/db", map[string]any{"op": "set", "path": "notes/n1", "data": map[string]any{"x": 1}, "as_level": "admin"}, &out); code != 400 {
		t.Fatalf("as_level admin under an owner rule: %d %v", code, out)
	}
	if code := h.bearer(tok, "POST", "/api/rt/targets/ws1/db", map[string]any{"op": "query", "collection": "tasks",
		"query": map[string]any{"filters": []any{map[string]any{"field": "title", "op": "==", "value": "two"}}}}, &out); code != 200 || len(out["docs"].([]any)) != 1 {
		t.Fatalf("agent query %d %v", code, out)
	}

	// Rooms: a second view hears the first one's moments and presence.
	b := h.openView(manuel, "ws1")
	b.stream()
	if _, e := a.rpc("room.join", map[string]any{"room": ""}); e != "" {
		t.Fatalf("join %s", e)
	}
	if _, e := b.rpc("room.join", map[string]any{"room": ""}); e != "" {
		t.Fatalf("join %s", e)
	}
	if _, e := a.rpc("room.presence", map[string]any{"room": "", "patch": map[string]any{"cursor": []int{1, 2}}}); e != "" {
		t.Fatalf("presence %s", e)
	}
	for {
		ev := b.next("peers")
		if ps := ev.Data["peers"].([]any); len(ps) == 2 && strings.Contains(mustJSON(ps), "cursor") {
			break
		}
	}
	if _, e := a.rpc("room.emit", map[string]any{"room": "", "topic": "ping", "data": map[string]any{"n": 1}}); e != "" {
		t.Fatalf("emit %s", e)
	}
	if ev := b.next("room"); ev.Data["topic"] != "ping" || ev.Data["peer"] != a.id || ev.Data["by"] != manuel.id() {
		t.Fatalf("room event %v", ev)
	}
	if _, e := a.rpc("room.emit", map[string]any{"room": "", "topic": "ping", "data": strings.Repeat("x", 5000)}); e != "invalid_argument" {
		t.Fatalf("oversized emit %q", e)
	}

	// slop: refused until an admin approves the version's permissions.
	resp, _ := http.DefaultClient.Do(a.req("GET", "/_rt/api/routes?host=site.test", nil))
	if resp.StatusCode != 403 {
		t.Fatalf("unapproved slop %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	if code := manuel.do("POST", "/api/apps/tracker/approve", map[string]any{"version": 1}, &out); code != 200 {
		t.Fatalf("approve %d %v", code, out)
	}
	c := h.openView(manuel, "ws1")
	if hello := c.stream(); hello["caps"].(map[string]any)["slop"] == nil {
		t.Fatalf("approved hello %v", hello)
	}
	resp, _ = http.DefaultClient.Do(c.req("GET", "/_rt/api/routes?host=site.test", nil))
	if resp.StatusCode != 200 {
		t.Fatalf("approved slop %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	resp, _ = http.DefaultClient.Do(c.req("GET", "/_rt/api/users", nil))
	if resp.StatusCode != 403 {
		t.Fatalf("slop beyond its permissions %d", resp.StatusCode)
	}
	_ = resp.Body.Close()
	// A view's secret is only good on its own target's origin.
	other := &viewClient{h: h, host: h.openView(manuel, "tracker").host, secret: c.secret}
	if _, e := other.rpc("db.get", map[string]any{"path": "tasks/t1"}); e != "revoked" {
		t.Fatal("secret accepted on a foreign origin")
	}

	// A changed role closes the person's views.
	ada := h.signIn("ada")
	d := h.openView(ada, "ws1")
	if hello := d.stream(); hello["level"] != "admin" {
		t.Fatalf("ada's level %v", hello["level"])
	}
	if code := manuel.do("PATCH", "/api/users/"+ada.id(), map[string]any{"role": "pending"}, &out); code != 200 {
		t.Fatalf("role change: %d %v", code, out)
	}
	d.next("revoked")
	if _, e := d.rpc("db.get", map[string]any{"path": "tasks/t1"}); e != "revoked" {
		t.Fatalf("closed view still answers: %q", e)
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
