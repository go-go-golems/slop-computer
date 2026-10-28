package server

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

func sum(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

// upload puts a blob with a token.
func (h *harness) upload(token string, data []byte) string {
	h.t.Helper()
	s := sum(data)
	req, _ := http.NewRequest("PUT", h.ts.URL+"/api/blobs/"+s, bytes.NewReader(data))
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 201 {
		h.t.Fatalf("upload: %v %v", err, resp)
	}
	return s
}

// sse reads server-sent events from /api/events into a channel.
func (h *harness) sse(token string, after string) chan store.Event {
	h.t.Helper()
	req, _ := http.NewRequest("GET", h.ts.URL+"/api/events?after="+after, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 {
		h.t.Fatalf("sse: %v %v", err, resp)
	}
	h.t.Cleanup(func() { _ = resp.Body.Close() })
	out := make(chan store.Event, 100)
	go func() {
		sc := bufio.NewScanner(resp.Body)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "data: ") {
				var ev store.Event
				if json.Unmarshal([]byte(line[6:]), &ev) == nil && ev.Type != "" {
					out <- ev
				}
			}
		}
		close(out)
	}()
	return out
}

func TestKernelAPI(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	var agentTok map[string]any
	h.call(http.DefaultClient, "POST", "/api/local/token", map[string]any{"nickname": "claude-manuel"}, &agentTok, nil)
	agent := agentTok["token"].(string)
	events := h.sse(agent, "0")

	if code := manuel.do("PUT", "/api/projects/lab-site", map[string]any{"name": "Lab site", "brief": "The site"}, nil); code != 200 {
		t.Fatalf("project: %d", code)
	}
	html := []byte("<!doctype html><title>Pricing</title><h1>Pricing</h1>")
	css := []byte("h1{color:red}")

	// Push with a blob that was never uploaded → 409 missing_blobs.
	var res map[string]any
	if code := h.bearer(agent, "POST", "/api/artifacts/pricing/versions", map[string]any{"tree": map[string]string{"index.html": sum(html)},
		"create": map[string]any{"title": "Pricing", "kind": "page", "project": "lab-site"}}, &res); code != 409 || res["missing"] == nil {
		t.Fatalf("missing blobs: %d %v", code, res)
	}
	var missing map[string][]string
	h.bearer(agent, "POST", "/api/blobs/missing", map[string]any{"sha256": []string{sum(html), sum(css)}}, &missing)
	if len(missing["missing"]) != 2 {
		t.Fatalf("missing list %v", missing)
	}
	hHTML, hCSS := h.upload(agent, html), h.upload(agent, css)
	if code := h.bearer(agent, "POST", "/api/artifacts/pricing/versions", map[string]any{"tree": map[string]string{"index.html": hHTML, "../x": hCSS},
		"create": map[string]any{"title": "Pricing", "kind": "page", "project": "lab-site"}}, nil); code != 400 {
		t.Fatalf("path traversal: %d", code)
	}
	if code := h.bearer(agent, "POST", "/api/artifacts/pricing/versions", map[string]any{"tree": map[string]string{"index.html": hHTML},
		"message": "first", "via": "claude", "create": map[string]any{"title": "Pricing", "kind": "page", "project": "lab-site"}}, &res); code != 201 {
		t.Fatalf("push 1: %d %v", code, res)
	}
	if v := res["version"].(map[string]any); v["via"] != "claude" || v["n"].(float64) != 1 {
		t.Fatalf("push 1 version %v", v)
	}
	if code := h.bearer(agent, "POST", "/api/artifacts/pricing/versions", map[string]any{"tree": map[string]string{"index.html": hHTML, "a.css": hCSS}}, &res); code != 409 {
		t.Fatalf("push without base must hit main_moved: %d %v", code, res)
	}
	if code := h.bearer(agent, "POST", "/api/artifacts/pricing/versions", map[string]any{"base": 1, "tree": map[string]string{"index.html": hHTML, "a.css": hCSS}, "message": "css"}, &res); code != 201 {
		t.Fatalf("push 2: %d %v", code, res)
	}
	// Files come back byte for byte.
	req, _ := http.NewRequest("GET", h.ts.URL+"/api/artifacts/pricing/versions/main/files/a.css", nil)
	req.Header.Set("Authorization", "Bearer "+agent)
	resp, err := http.DefaultClient.Do(req)
	if err != nil || resp.StatusCode != 200 || resp.Header.Get("ETag") != `"`+hCSS+`"` {
		t.Fatalf("file: %v %v", err, resp)
	}
	_ = resp.Body.Close()

	// Route, thread from the browser, reply from the agent.
	if code := manuel.do("PUT", "/api/routes", map[string]any{"host": "site.localhost", "path": "/pricing", "page": "pricing", "version": 1}, nil); code != 200 {
		t.Fatalf("route: %d", code)
	}
	var thread store.Thread
	if code := manuel.do("POST", "/api/artifacts/pricing/threads", map[string]any{"version": 2, "anchor": map[string]any{"selector": "h1"}, "text": "too red"}, &thread); code != 201 {
		t.Fatalf("thread: %d", code)
	}
	if code := h.bearer(agent, "POST", "/api/threads/"+thread.ID+"/replies", map[string]any{"text": "fixed", "version": 2}, nil); code != 201 {
		t.Fatalf("reply: %d", code)
	}

	want := []string{store.EvProjectUpdated, store.EvArtifactCreated, store.EvVersionCreated, store.EvVersionCreated, store.EvRouteSet, store.EvThreadCreated, store.EvCommentCreated}
	var got []string
	timeout := time.After(3 * time.Second)
	for len(got) < len(want) {
		select {
		case ev := <-events:
			if ev.Seq != 0 {
				got = append(got, ev.Type)
			}
		case <-timeout:
			t.Fatalf("events so far %v, want %v", got, want)
		}
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("events %v, want %v", got, want)
		}
	}
}

func TestCommentsWait(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	// The agent's token belongs to manuel, as in production.
	agent := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	page := h.upload(agent, []byte("<p>hi"))
	h.bearer(agent, "POST", "/api/artifacts/hello/versions", map[string]any{"tree": map[string]string{"index.html": page}, "create": map[string]any{"title": "Hello", "kind": "page"}}, nil)

	// Timeout without comments.
	if code := h.bearer(agent, "GET", "/api/comments/wait?artifact=hello&timeout=1", nil, nil); code != 204 {
		t.Fatalf("timeout: %d", code)
	}
	type answer struct {
		code int
		body map[string]any
	}
	done := make(chan answer, 1)
	go func() {
		var body map[string]any
		code := h.bearer(agent, "GET", "/api/comments/wait?artifact=hello&timeout=10", nil, &body)
		done <- answer{code, body}
	}()
	// Wait until the agent is registered, then comment from the browser.
	deadline := time.Now().Add(3 * time.Second)
	for {
		var ws []Waiter
		h.bearer(agent, "GET", "/api/agents", nil, &ws)
		if len(ws) == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("waiter never registered")
		}
		time.Sleep(20 * time.Millisecond)
	}
	var th store.Thread
	manuel.do("POST", "/api/artifacts/hello/threads", map[string]any{"version": 1, "anchor": map[string]any{"selector": "p"}, "text": "bigger"}, &th)
	a := <-done
	if a.code != 200 || a.body["thread"].(map[string]any)["id"] != th.ID {
		t.Fatalf("wait: %d %v", a.code, a.body)
	}
	seq := int(a.body["seq"].(float64))

	// The agent's own reply does not wake it; the owner's next comment does.
	h.bearer(agent, "POST", "/api/threads/"+th.ID+"/replies", map[string]any{"text": "done"}, nil)
	if code := h.bearer(agent, "GET", "/api/comments/wait?artifact=hello&timeout=1&after="+strconv.Itoa(seq), nil, nil); code != 204 {
		t.Fatalf("own reply woke the agent: %d", code)
	}
	manuel.do("POST", "/api/threads/"+th.ID+"/replies", map[string]any{"text": "still too small"}, nil)
	var again map[string]any
	if code := h.bearer(agent, "GET", "/api/comments/wait?artifact=hello&timeout=1&after="+strconv.Itoa(seq), nil, &again); code != 200 || again["type"] != store.EvCommentCreated {
		t.Fatalf("replay after cursor: %d %v", code, again)
	}
}
