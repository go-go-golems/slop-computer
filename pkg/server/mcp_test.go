package server

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/llm"
)

// mcpPost sends one JSON-RPC message to /mcp and returns the HTTP answer.
func mcpPost(t *testing.T, h *harness, token string, msg map[string]any, hdr map[string]string) *http.Response {
	t.Helper()
	msg["jsonrpc"] = "2.0"
	body, _ := json.Marshal(msg)
	req, _ := http.NewRequest("POST", h.ts.URL+"/mcp", bytes.NewReader(body))
	req.Host = h.cfg.Hosts.Main
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// mcpResult is a JSON response's result (failing on a JSON-RPC error).
func mcpResult(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("status %d: %v", resp.StatusCode, err)
	}
	r, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result: %v", out)
	}
	return r
}

// The MCP door (SLOP3-009 step 6) is generated from the verb table: a
// token's callable verbs are its tools, with schemas and read-only hints;
// a call runs the verb as the token's person; a stream verb sends progress.
func TestMCPDoor(t *testing.T) {
	h := newHarness(t)
	h.a.LLM = &llm.Fake{}
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	reader := h.tokenFor("mia@example.com", "read")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada", "year": 1990}})

	// Without a token: 401 with a Bearer challenge; another site's page: 403.
	if r := mcpPost(t, h, "", map[string]any{"id": 1, "method": "ping"}, nil); r.StatusCode != 401 || !strings.HasPrefix(r.Header.Get("WWW-Authenticate"), "Bearer") {
		t.Fatalf("no token: %d %q", r.StatusCode, r.Header.Get("WWW-Authenticate"))
	}
	if r := mcpPost(t, h, admin, map[string]any{"id": 1, "method": "ping"}, map[string]string{"Origin": "https://evil.example"}); r.StatusCode != 403 {
		t.Fatalf("foreign origin: %d", r.StatusCode)
	}

	init := mcpResult(t, mcpPost(t, h, admin, map[string]any{"id": 1, "method": "initialize",
		"params": map[string]any{"protocolVersion": "2025-03-26", "capabilities": map[string]any{}, "clientInfo": map[string]any{"name": "test"}}}, nil))
	if init["protocolVersion"] != "2025-03-26" || init["capabilities"].(map[string]any)["tools"] == nil {
		t.Fatalf("initialize: %v", init)
	}
	if r := mcpPost(t, h, admin, map[string]any{"method": "notifications/initialized"}, nil); r.StatusCode != 202 {
		t.Fatalf("a notification: %d", r.StatusCode)
	}

	tools := func(tok string) map[string]map[string]any {
		out := map[string]map[string]any{}
		for _, x := range mcpResult(t, mcpPost(t, h, tok, map[string]any{"id": 2, "method": "tools/list"}, nil))["tools"].([]any) {
			m := x.(map[string]any)
			out[m["name"].(string)] = m
		}
		return out
	}
	all := tools(admin)
	q, ok := all["docs_query"]
	if !ok || q["inputSchema"].(map[string]any)["properties"].(map[string]any)["where"] == nil ||
		q["annotations"].(map[string]any)["readOnlyHint"] != true {
		t.Fatalf("docs_query tool: %v", q)
	}
	if all["grant_set"]["annotations"].(map[string]any)["readOnlyHint"] != false {
		t.Fatalf("grant_set is not read-only: %v", all["grant_set"])
	}
	// A read token lists no write verb, and nobody but admins admin verbs.
	mine := tools(reader)
	if _, ok := mine["docs_query"]; !ok {
		t.Fatal("the read token has no docs_query")
	}
	for _, name := range []string{"docs_set", "grant_set", "store_type"} {
		if _, ok := mine[name]; ok {
			t.Fatalf("the read token lists %s", name)
		}
	}

	// A call runs the verb; its result is text and structured content.
	call := func(tok, name string, args map[string]any) map[string]any {
		return mcpResult(t, mcpPost(t, h, tok, map[string]any{"id": 3, "method": "tools/call", "params": map[string]any{"name": name, "arguments": args}}, nil))
	}
	res := call(admin, "docs_get", map[string]any{"store": "crm", "path": "contacts/c1"})
	if res["isError"] == true || res["structuredContent"].(map[string]any)["body"].(map[string]any)["name"] != "Ada" {
		t.Fatalf("docs_get: %v", res)
	}
	res = call(admin, "docs_query", map[string]any{"store": "crm", "coll": "contacts", "where": []any{[]any{"year", "<", 2000}}})
	if txt := res["content"].([]any)[0].(map[string]any)["text"].(string); !strings.Contains(txt, "Ada") || res["structuredContent"] != nil {
		t.Fatalf("docs_query (a list: text only): %v", res)
	}
	// A refusal is a tool error the model reads, not a protocol error.
	res = call(reader, "docs_set", map[string]any{"store": "crm", "path": "contacts/c2", "data": map[string]any{}})
	if res["isError"] != true || !strings.HasPrefix(res["content"].([]any)[0].(map[string]any)["text"].(string), "permission_denied") {
		t.Fatalf("a refused call: %v", res)
	}
	// The log says the change came through MCP.
	call(admin, "docs_set", map[string]any{"store": "crm", "path": "contacts/c3", "data": map[string]any{"name": "Cy"}})
	log := h.call(admin, "log.show", map[string]any{"store": "crm", "limit": 1}).([]any)
	if via := log[0].(map[string]any)["via"].(string); !strings.HasPrefix(via, "mcp") {
		t.Fatalf("via = %q", via)
	}

	// An unknown tool and an unknown method are protocol errors.
	for _, msg := range []map[string]any{
		{"id": 4, "method": "tools/call", "params": map[string]any{"name": "no_such_tool"}},
		{"id": 5, "method": "resources/list"},
	} {
		r := mcpPost(t, h, admin, msg, nil)
		var out map[string]any
		_ = json.NewDecoder(r.Body).Decode(&out)
		r.Body.Close()
		if out["error"] == nil {
			t.Fatalf("%v: %v", msg, out)
		}
	}

	// sample_run with a progress token: progress per part, then the result.
	r := mcpPost(t, h, admin, map[string]any{"id": 6, "method": "tools/call", "params": map[string]any{
		"name": "sample_run", "arguments": map[string]any{"input": "fixture:stream"}, "_meta": map[string]any{"progressToken": "p1"}}}, nil)
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "text/event-stream") {
		b, _ := io.ReadAll(r.Body)
		t.Fatalf("sample_run did not stream: %s", b)
	}
	var progress []string
	var final map[string]any
	sc := bufio.NewScanner(r.Body)
	for sc.Scan() {
		data, ok := strings.CutPrefix(sc.Text(), "data: ")
		if !ok {
			continue
		}
		var m map[string]any
		_ = json.Unmarshal([]byte(data), &m)
		if m["method"] == "notifications/progress" {
			p := m["params"].(map[string]any)
			if p["progressToken"] != "p1" {
				t.Fatalf("progress: %v", p)
			}
			progress = append(progress, p["message"].(string))
		} else if m["result"] != nil {
			final = m["result"].(map[string]any)
		}
	}
	r.Body.Close()
	if strings.Join(progress, "") != "first second third" || final["structuredContent"].(map[string]any)["text"] != "first second third" {
		t.Fatalf("progress %q, final %v", progress, final)
	}
}
