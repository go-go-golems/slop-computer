package server

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// sse reads server-sent events from a streaming response.
type sse struct {
	t    *testing.T
	ch   chan [2]string // type, data
	stop context.CancelFunc
}

func (h *harness) stream(token, path string) *sse {
	h.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", h.ts.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		cancel()
		h.t.Fatalf("stream %s: %v %v", path, err, resp)
	}
	s := &sse{t: h.t, ch: make(chan [2]string, 100), stop: cancel}
	go func() {
		defer func() { _ = resp.Body.Close() }()
		sc := bufio.NewScanner(resp.Body)
		sc.Buffer(make([]byte, 1<<20), 1<<20)
		typ, data := "", ""
		for sc.Scan() {
			line := sc.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				typ = line[7:]
			case strings.HasPrefix(line, "data: "):
				data = line[6:]
			case line == "" && typ != "":
				s.ch <- [2]string{typ, data}
				typ, data = "", ""
			}
		}
	}()
	h.t.Cleanup(cancel)
	return s
}

func (s *sse) next() (string, map[string]any) {
	s.t.Helper()
	select {
	case ev := <-s.ch:
		var m map[string]any
		_ = json.Unmarshal([]byte(ev[1]), &m)
		return ev[0], m
	case <-time.After(3 * time.Second):
		s.t.Fatal("no event within 3s")
		return "", nil
	}
}

func TestDocsAPI(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	h.pushFiles(tok, "design-x", map[string]any{"title": "Design X", "kind": "data", "type": "pinup"}, nil, map[string]string{"file.json": `{"name":"X"}`})
	h.pushFiles(tok, "journal", map[string]any{"title": "Journal", "kind": "data", "type": "post"}, nil, map[string]string{"posts/a.md": "# A"})
	for id, perms := range map[string][]string{"pinup": {"docs:read", "docs:write"}, "viewer": {"docs:read"}} {
		h.pushFiles(tok, id, map[string]any{"title": id, "kind": "page"}, map[string]any{"tool": map[string]any{"title": id, "permissions": perms}},
			map[string]string{"index.html": "<p>" + id})
	}
	grant := func(id string) string {
		var g struct {
			Grant  string                       `json:"grant"`
			People map[string]map[string]string `json:"people"`
		}
		if code := manuel.do("POST", "/api/tools/"+id+"/grant", map[string]any{"n": 1, "try": true}, &g); code != 200 || g.People[manuel.id()]["name"] == "" {
			t.Fatalf("grant %s: %d %+v", id, code, g)
		}
		return g.Grant
	}
	pinup, viewer := grant("pinup"), grant("viewer")

	// The stream replays (nothing yet), says ready, then goes live.
	st := h.stream(pinup, "/api/docs/design-x/events?after=0")
	if typ, m := st.next(); typ != "ready" || m["rev"].(float64) != 0 {
		t.Fatalf("ready %s %v", typ, m)
	}
	var put map[string]any
	if code := h.bearer(pinup, "PUT", "/api/docs/design-x/nodes/n1", map[string]any{"type": "frame"}, &put); code != 200 || put["rev"].(float64) != 1 {
		t.Fatalf("put %d %v", code, put)
	}
	if typ, m := st.next(); typ != "doc" || m["path"] != "nodes/n1" || m["data"].(map[string]any)["type"] != "frame" || m["by"] != manuel.id() {
		t.Fatalf("live doc event %s %v", typ, m)
	}
	h.bearer(pinup, "PUT", "/api/docs/design-x/meta/file", map[string]any{"name": "X"}, nil)
	st.next()
	if code := h.bearer(pinup, "DELETE", "/api/docs/design-x/nodes/n1", nil, nil); code != 200 {
		t.Fatalf("delete %d", code)
	}
	if typ, m := st.next(); typ != "doc" || m["path"] != "nodes/n1" || m["data"] != nil || m["rev"].(float64) != 3 {
		t.Fatalf("tombstone event %s %v", typ, m)
	}

	// A client back after rev 1 catches up from the table, tombstone included.
	back := h.stream(tok, "/api/docs/design-x/events?after=1")
	if typ, m := back.next(); typ != "doc" || m["path"] != "meta/file" {
		t.Fatalf("replay 1 %s %v", typ, m)
	}
	if typ, m := back.next(); typ != "doc" || m["path"] != "nodes/n1" || m["data"] != nil {
		t.Fatalf("replay 2 %s %v", typ, m)
	}
	if typ, m := back.next(); typ != "ready" || m["rev"].(float64) != 3 {
		t.Fatalf("ready after replay %s %v", typ, m)
	}

	var list struct {
		Docs []store.Doc `json:"docs"`
		Rev  int64       `json:"rev"`
	}
	if code := h.bearer(viewer, "GET", "/api/docs/design-x", nil, &list); code != 200 || len(list.Docs) != 1 || list.Rev != 3 {
		t.Fatalf("list %d %+v", code, list)
	}
	for _, c := range []struct {
		who, method, path string
		body              any
		want              int
	}{
		{viewer, "PUT", "/api/docs/design-x/nodes/n2", map[string]any{}, 403}, // docs:read only
		{pinup, "PUT", "/api/docs/journal/nodes/n2", map[string]any{}, 400},   // not a pinup artifact
		{pinup, "PUT", "/api/docs/design-x/nodes/n2", []int{1}, 400},          // not an object
		{pinup, "GET", "/api/docs/design-x/nodes/n1", nil, 404},               // deleted
		{pinup, "PUT", "/api/docs/nope/nodes/n2", map[string]any{}, 404},      // no artifact
		{pinup, "GET", "/api/events", nil, 403},                               // events:read not granted
		{pinup, "PUT", "/api/docs/design-x/nodes/big", map[string]any{"x": strings.Repeat("a", 300<<10)}, 413},
	} {
		if code := h.bearer(c.who, c.method, c.path, c.body, nil); code != c.want {
			t.Errorf("%s %s → %d, want %d", c.method, c.path, code, c.want)
		}
	}

	// Leases.
	h.bearer(pinup, "PUT", "/api/docs/design-x/inbox/s1", map[string]any{"html": "<p>"}, nil)
	var l map[string]bool
	if h.bearer(pinup, "POST", "/api/docs/design-x/inbox/s1/acquire", map[string]any{"holder": "tab-a", "ttlMs": 30000}, &l); !l["acquired"] {
		t.Fatal("tab-a acquires")
	}
	if h.bearer(pinup, "POST", "/api/docs/design-x/inbox/s1/acquire", map[string]any{"holder": "tab-b", "ttlMs": 30000}, &l); l["acquired"] {
		t.Fatal("tab-b must not")
	}

	// Presence reaches the design's streams, and never the kernel stream.
	kernel := h.stream(tok, "/api/events")
	if typ, _ := kernel.next(); typ != "ready" {
		t.Fatalf("kernel ready %s", typ)
	}
	for st.next(); len(st.ch) > 0; st.next() { // drain inbox/s1
	}
	if code := h.bearer(pinup, "POST", "/api/presence/design-x", map[string]any{"peer": "tab-a", "presence": map[string]any{"page": "p1"}}, nil); code != 200 {
		t.Fatalf("presence %d", code)
	}
	if typ, m := st.next(); typ != "presence" || m["peer"] != "tab-a" || m["user"] != manuel.id() || m["kind"] != "viewer" {
		t.Fatalf("presence event %s %v", typ, m)
	}
	var peers struct {
		Peers []map[string]any `json:"peers"`
	}
	if code := h.bearer(viewer, "GET", "/api/presence/design-x", nil, &peers); code != 200 || len(peers.Peers) != 1 || peers.Peers[0]["presence"].(map[string]any)["page"] != "p1" {
		t.Fatalf("peers %d %+v", code, peers)
	}
	manuel.do("PUT", "/api/projects/later", map[string]any{"name": "Later"}, nil)
	if typ, m := kernel.next(); typ != store.EvProjectUpdated {
		t.Fatalf("the kernel stream must skip doc and presence events, got %s %v", typ, m)
	}
	if code := h.bearer(pinup, "POST", "/api/presence/design-x", map[string]any{"peer": "tab-a", "left": true}, nil); code != 200 {
		t.Fatalf("leave %d", code)
	}
	if typ, m := st.next(); typ != "presence" || m["left"] != true {
		t.Fatalf("left event %s %v", typ, m)
	}
}
