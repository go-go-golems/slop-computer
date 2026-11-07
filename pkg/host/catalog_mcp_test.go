package host

// SLOP3-015 view 4: the catalog's MCP endpoint is an express actor with one
// public route, on the live host (a store that runs an actor cannot be
// mounted on the static host). A visitor without a session gets JSON-RPC
// answers from the catalog the store was deployed with.

import (
	"encoding/json"
	"strings"
	"testing"
)

const mcpCatalog = `{"generated":"2026-11-07T00:00:00Z","appsOrigin":"https://apps.example","count":2,
 "tags":[{"tag":"game","count":1},{"tag":"shaders","count":1}],
 "items":[
  {"id":"weft","title":"Weft","description":"A shader language whose pixels are glyphs","tags":["shaders"],"capabilities":["sample"],"free":true,"version":"1.0.0","publishedAt":"2026-10-23T20:15:50Z","bytes":1042897,"open":"https://apps.example/f/weft/","download":"/_s/weft/main/index.html","attachments":[]},
  {"id":"mimeo","title":"Mimeo","description":"A printing press game","tags":["game"],"capabilities":["room","sample"],"free":false,"version":"0.1.0","publishedAt":"2026-10-24T10:00:00Z","bytes":997000,"open":"https://apps.example/f/mimeo/","download":null,"attachments":[],
   "releases":[{"version":"0.1.0","publishedAt":"2026-10-24T10:00:00Z","changelog":"first"}]}]}`

func TestCatalogMCPEndpoint(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	fs := append(appDir(t, "catalog-mcp"), map[string]any{"path": "data/catalog.json", "text": mcpCatalog})
	h.call(admin, "store.new", map[string]any{"id": "catalog-mcp"})
	h.call(admin, "files.push", map[string]any{"store": "catalog-mcp", "files": fs})
	if st := h.call(admin, "app.status", map[string]any{"store": "catalog-mcp"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	h.call(admin, "grant.set", map[string]any{"store": "catalog-mcp", "subject": "@guest", "level": "view"})
	// The mount's API policy as 02-deploy.py sets it: the two routes, open
	// to everyone, CORS for the catalog's site, and a per-IP rate limit.
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/catalog/mcp", "store": "catalog-mcp", "api": map[string]any{
		"routes": []any{"POST /", "GET /"}, "defaultMin": "public",
		"middleware": []any{
			map[string]any{"name": "rateLimit", "config": map[string]any{"per": "ip", "limit": 60, "window": "1m", "burst": 120}},
			map[string]any{"name": "cors", "config": map[string]any{"origins": []any{"https://site.example"}}},
		},
	}})

	rpc := func(msg string) (int, map[string]any, string) {
		t.Helper()
		r, body := h.raw("POST", live, "/catalog/mcp", strings.NewReader(msg),
			map[string]string{"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
		var out map[string]any
		_ = json.Unmarshal([]byte(body), &out)
		return r.StatusCode, out, body
	}

	code, out, body := rpc(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}`)
	res, _ := out["result"].(map[string]any)
	if code != 200 || res["protocolVersion"] != "2025-03-26" || res["serverInfo"].(map[string]any)["name"] != "slop-catalog" {
		t.Fatalf("initialize: %d %s", code, body)
	}
	if code, _, body := rpc(`{"jsonrpc":"2.0","method":"notifications/initialized"}`); code != 202 || body != "" {
		t.Fatalf("notification: %d %q", code, body)
	}
	_, out, body = rpc(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if !strings.Contains(body, `"search_apps"`) || !strings.Contains(body, `"readOnlyHint":true`) {
		t.Fatalf("tools/list: %s", body)
	}
	_, out, body = rpc(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_apps","arguments":{"query":"shader"}}}`)
	sc := out["result"].(map[string]any)["structuredContent"].(map[string]any)
	if sc["total"] != 1.0 || !strings.Contains(body, `\"id\": \"weft\"`) {
		t.Fatalf("search: %s", body)
	}
	_, _, body = rpc(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_app","arguments":{"id":"mimeo"}}}`)
	if !strings.Contains(body, `"access":"subscribers"`) || !strings.Contains(body, `"changelog":"first"`) || !strings.Contains(body, `"html":null`) {
		t.Fatalf("get_app: %s", body)
	}
	_, out, _ = rpc(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_app","arguments":{"id":"nope"}}}`)
	if out["result"].(map[string]any)["isError"] != true {
		t.Fatalf("get_app nope: %v", out)
	}
	if _, out, _ := rpc(`{"jsonrpc":"2.0","id":6,"method":"resources/list"}`); out["error"].(map[string]any)["code"] != -32601.0 {
		t.Fatalf("unknown method: %v", out)
	}
	// A batch answers each request and skips the notifications.
	r, body := h.raw("POST", live, "/catalog/mcp", strings.NewReader(`[{"jsonrpc":"2.0","id":7,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/x"}]`),
		map[string]string{"Content-Type": "application/json"})
	if r.StatusCode != 200 || !strings.HasPrefix(body, `[{"id":7`) && !strings.HasPrefix(body, `[{"jsonrpc"`) || strings.Count(body, `"id"`) != 1 {
		t.Fatalf("batch: %d %s", r.StatusCode, body)
	}
	// The catalog's site may call it from a browser: a preflight, then the
	// answer carries the origin. Another origin gets no CORS headers.
	pre, _ := h.raw("OPTIONS", live, "/catalog/mcp", nil, map[string]string{
		"Origin": "https://site.example", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
	if pre.StatusCode != 204 || pre.Header.Get("Access-Control-Allow-Origin") != "https://site.example" || !strings.Contains(pre.Header.Get("Access-Control-Allow-Methods"), "POST") {
		t.Fatalf("preflight: %d %v", pre.StatusCode, pre.Header)
	}
	for origin, want := range map[string]string{"https://site.example": "https://site.example", "https://evil.example": ""} {
		r, _ := h.raw("POST", live, "/catalog/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":8,"method":"ping"}`),
			map[string]string{"Content-Type": "application/json", "Origin": origin})
		if r.StatusCode != 200 || r.Header.Get("Access-Control-Allow-Origin") != want {
			t.Fatalf("POST from %s: %d %q", origin, r.StatusCode, r.Header.Get("Access-Control-Allow-Origin"))
		}
	}
	// A GET says what this is.
	if r, body := h.get(live, "/catalog/mcp"); r.StatusCode != 405 || !strings.Contains(body, "streamable-http") {
		t.Fatalf("GET: %d %s", r.StatusCode, body)
	}
}
