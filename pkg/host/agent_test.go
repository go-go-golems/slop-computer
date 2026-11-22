package host

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// SLOP3-025: a page declares agent; it is granted like sample (the sample
// policy for the audience); a session's messages are charged to the
// person's LLM budget, round by round.
func TestPageAgentSession(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.a.SetLLM(&llm.Fake{})
	h.call(admin, "store.new", map[string]any{"id": "ag"})
	h.push(admin, map[string]any{"store": "ag", "files": files(map[string]string{
		"app.json":   `{"title":"Agent","capabilities":{"agent":{}}}`,
		"index.html": "<!doctype html><title>agent</title>",
	})})
	h.call(admin, "grant.set", map[string]any{"store": "ag", "subject": "@member", "level": "interact"})
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/ag", "store": "ag"})
	h.call(admin, "llm.set", map[string]any{"subject": "@member", "value": "on", "budget": 10000})

	b := h.browser()
	b.signIn("ivy@example.com")
	s := h.site(live)
	signInSite(t, h, s, b, live, "/ag")
	_, v := openView(s, live, "/ag", "")
	if v["caps"].(map[string]any)["agent"] != nil {
		t.Fatalf("agent granted with the sample policy off: %v", v["caps"])
	}
	u := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	auth := map[string]string{"Authorization": "Bearer " + v["secret"].(string)}
	if resp, out := s.do("POST", u, "/_rt/agent/sessions", map[string]any{}, auth); resp.StatusCode != 403 {
		t.Fatalf("policy off: %d %v", resp.StatusCode, out)
	}

	h.call(admin, "policy.set", map[string]any{"app": "ag", "capability": "sample", "audience": "@member", "value": "on"})
	_, v = openView(s, live, "/ag", "")
	if v["caps"].(map[string]any)["agent"] == nil {
		t.Fatalf("agent not granted with the sample policy on: %v", v["caps"])
	}
	auth = map[string]string{"Authorization": "Bearer " + v["secret"].(string)}
	resp, out := s.do("POST", u, "/_rt/agent/sessions", map[string]any{"labels": map[string]string{"key": "t1"}, "data": map[string]any{"system": "Be brief."}}, auth)
	if resp.StatusCode != 201 {
		t.Fatalf("create: %d %v", resp.StatusCode, out)
	}
	id := out["sessionId"].(string)
	if sess := out["session"].(map[string]any); sess["labels"].(map[string]any)["app"] != "ag" {
		t.Fatalf("session = %v", sess)
	}
	if resp, out = s.do("POST", u, "/_rt/agent/sessions/"+id+"/messages", map[string]any{"prompt": "hello"}, auth); resp.StatusCode != 202 {
		t.Fatalf("message: %d %v", resp.StatusCode, out)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		_, out = s.do("GET", u, "/_rt/agent/sessions/"+id, nil, auth)
		if out["running"] == false && strings.Contains(toJSON(out["snapshot"]), "echo: hello") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no answer: %v", out)
		}
		time.Sleep(20 * time.Millisecond)
	}
	lim := rpc(s, v, "agent.limits", map[string]any{})["result"].(map[string]any)
	if rem := lim["remaining"].(float64); rem >= 10000 || rem <= 0 {
		t.Fatalf("the round was not charged: %v", lim)
	}
}

func toJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}
