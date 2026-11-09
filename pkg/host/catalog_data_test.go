package host

// SLOP3-018: the catalog's data lives in one live store, catalog-data: SQL
// tables (sql/001_catalog.sql) that admins write through the actor's
// actions (importCatalog, upsertApp, removeApp), and routes that every
// view reads. One store, two mounts on the live host: /catalog/api serves
// every route (the views, across origins from the site host), and
// /catalog/mcp only MCP's two (the URL SLOP3-015's catalog-mcp had).

import (
	"encoding/json"
	"strings"
	"testing"
)

// catalogFixture is a catalog.json as SLOP3-015's build wrote it: weft has
// no release history, mimeo has one.
const catalogFixture = `{"generated":"2026-11-07T00:00:00Z","appsOrigin":"https://apps.example","count":2,
 "tags":[{"tag":"game","count":1},{"tag":"shaders","count":1}],
 "items":[
  {"id":"weft","title":"Weft","description":"A shader language whose pixels are glyphs","tags":["shaders"],"capabilities":["sample"],"free":true,"version":"1.0.0","publishedAt":"2026-10-23T20:15:50Z","bytes":1042897,"open":"https://apps.example/f/weft/","download":"/_s/weft/main/index.html","attachments":[]},
  {"id":"mimeo","title":"Mimeo","description":"A printing press game","tags":["game"],"capabilities":["room","sample"],"free":false,"version":"0.1.0","publishedAt":"2026-10-24T10:00:00Z","bytes":997000,"open":"https://apps.example/f/mimeo/","download":null,"attachments":[],
   "releases":[{"version":"0.1.0","publishedAt":"2026-10-24T10:00:00Z","changelog":"first"}]}]}`

// catalogAPI is the /catalog/api mount's policy as SLOP3-018's deploy sets
// it: every route, open to everyone, CORS for the site host, a per-IP rate
// limit, if-none-match forwarded (for 304s), and the feeds' media types.
var catalogAPI = map[string]any{
	"routes":     []any{"GET /", "POST /", "GET /catalog.json", "GET /apps", "GET /apps/:id", "GET /feed.xml", "GET /llms.txt", "GET /search-index.json"},
	"defaultMin": "public",
	"middleware": []any{
		map[string]any{"name": "rateLimit", "config": map[string]any{"per": "ip", "limit": 120, "window": "1m", "burst": 240}},
		map[string]any{"name": "cors", "config": map[string]any{"origins": []any{"https://site.example"}}},
	},
	"responseTypes":  []any{"application/json", "text/plain", "application/atom+xml"},
	"forwardHeaders": []any{"content-type", "accept", "user-agent", "if-none-match"},
}

// deployCatalogData creates catalog-data, mounts it as the deploy does and
// imports the fixture. It returns the live host.
func deployCatalogData(t *testing.T, h *harness, admin string) string {
	t.Helper()
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "catalog-data"})
	h.call(admin, "files.push", map[string]any{"store": "catalog-data", "files": appDir(t, "catalog-data")})
	if st := h.call(admin, "app.status", map[string]any{"store": "catalog-data"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("status = %v", st)
	}
	h.call(admin, "grant.set", map[string]any{"store": "catalog-data", "subject": "@guest", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/catalog/api", "store": "catalog-data", "api": catalogAPI})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/catalog/mcp", "store": "catalog-data", "api": map[string]any{
		"routes": []any{"POST /", "GET /"}, "defaultMin": "public",
		"middleware": []any{
			map[string]any{"name": "rateLimit", "config": map[string]any{"per": "ip", "limit": 60, "window": "1m", "burst": 120}},
			map[string]any{"name": "cors", "config": map[string]any{"origins": []any{"https://site.example"}}},
		},
	}})
	var cat map[string]any
	if err := json.Unmarshal([]byte(catalogFixture), &cat); err != nil {
		t.Fatal(err)
	}
	cat["siteOrigin"], cat["api"], cat["mcp"] = "https://site.example", "https://"+live+"/catalog/api", "https://"+live+"/catalog/mcp"
	out := h.call(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "importCatalog", "args": cat}).(map[string]any)
	if out["upserted"] != 2.0 || out["created"] != 2.0 || out["rev"] != 1.0 {
		t.Fatalf("importCatalog = %v", out)
	}
	return live
}

func TestCatalogData(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := deployCatalogData(t, h, admin)

	getJSON := func(path string, hdr map[string]string) (int, map[string]any, map[string][]string) {
		t.Helper()
		r, body := h.raw("GET", live, path, nil, hdr)
		var out map[string]any
		_ = json.Unmarshal([]byte(body), &out)
		return r.StatusCode, out, r.Header
	}

	// catalog.json, as the views read it: newest first, tags counted, each
	// item with its releases (weft's made from its own version).
	code, cat, hdr := getJSON("/catalog/api/catalog.json", nil)
	if code != 200 || cat["count"] != 2.0 || cat["totalBytes"] != 2039897.0 || cat["rev"] != 1.0 || cat["siteOrigin"] != "https://site.example" {
		t.Fatalf("catalog.json: %d %v", code, cat)
	}
	items := cat["items"].([]any)
	if items[0].(map[string]any)["id"] != "mimeo" || items[1].(map[string]any)["id"] != "weft" {
		t.Fatalf("order: %v", items)
	}
	weft := items[1].(map[string]any)
	if rel := weft["releases"].([]any); len(rel) != 1 || rel[0].(map[string]any)["version"] != "1.0.0" || weft["cover"] != nil || weft["featured"] != false {
		t.Fatalf("weft: %v", weft)
	}
	if tags := fmtAny(cat["tags"]); !strings.Contains(tags, "game") || !strings.Contains(tags, "shaders") {
		t.Fatalf("tags: %s", tags)
	}
	etag := hdr["Etag"]
	if len(etag) != 1 || etag[0] != `"c1"` || !strings.Contains(strings.Join(hdr["Cache-Control"], ","), "no-cache") {
		t.Fatalf("headers: %v", hdr)
	}
	// The browser has this rev: 304, no body.
	if r, body := h.raw("GET", live, "/catalog/api/catalog.json", nil, map[string]string{"If-None-Match": `"c1"`}); r.StatusCode != 304 || body != "" {
		t.Fatalf("If-None-Match: %d %q", r.StatusCode, body)
	}
	// The site host reads it across origins; another origin gets no CORS.
	for origin, want := range map[string]string{"https://site.example": "https://site.example", "https://evil.example": ""} {
		_, _, hdr := getJSON("/catalog/api/catalog.json", map[string]string{"Origin": origin})
		if got := strings.Join(hdr["Access-Control-Allow-Origin"], ""); got != want {
			t.Fatalf("CORS for %s: %q", origin, got)
		}
	}

	// Queries: words, tag, capability, access; one app; a missing one.
	for path, want := range map[string]string{
		"/catalog/api/apps?q=shader":        "weft",
		"/catalog/api/apps?q=PRINTING+game": "mimeo",
		"/catalog/api/apps?tag=game":        "mimeo",
		"/catalog/api/apps?cap=room":        "mimeo",
		"/catalog/api/apps?free=1":          "weft",
		"/catalog/api/apps?free=0":          "mimeo",
	} {
		code, out, _ := getJSON(path, nil)
		got := out["items"].([]any)
		if code != 200 || out["total"] != 1.0 || got[0].(map[string]any)["id"] != want {
			t.Errorf("%s: %d %v", path, code, out)
		}
	}
	if _, out, _ := getJSON("/catalog/api/apps?q=nothing+like+this", nil); out["total"] != 0.0 {
		t.Errorf("no match: %v", out)
	}
	if _, out, _ := getJSON("/catalog/api/apps?sort=size&limit=1", nil); out["total"] != 2.0 || len(out["items"].([]any)) != 1 || out["items"].([]any)[0].(map[string]any)["id"] != "weft" {
		t.Errorf("sort and limit: %v", out)
	}
	if code, out, _ := getJSON("/catalog/api/apps/mimeo", nil); code != 200 || !strings.Contains(fmtAny(out["releases"]), "first") {
		t.Errorf("one app: %d %v", code, out)
	}
	if code, _, _ := getJSON("/catalog/api/apps/nope", nil); code != 404 {
		t.Errorf("missing app: %d", code)
	}
	// The files the old build wrote, from the tables.
	for path, want := range map[string][2]string{
		"/catalog/api/feed.xml":          {"application/atom+xml", "<title>Mimeo 0.1.0</title>"},
		"/catalog/api/llms.txt":          {"text/plain", "- [Weft](https://apps.example/f/weft/): A shader language"},
		"/catalog/api/search-index.json": {"application/json", `"text":"weft a shader language whose pixels are glyphs weft shaders"`},
	} {
		r, body := h.raw("GET", live, path, nil, nil)
		if r.StatusCode != 200 || !strings.HasPrefix(r.Header.Get("Content-Type"), want[0]) || !strings.Contains(body, want[1]) {
			t.Errorf("%s: %d %q %.300s", path, r.StatusCode, r.Header.Get("Content-Type"), body)
		}
	}

	// Writes are the admin's: a member's call is refused.
	member := h.tokenFor("ada@example.com", "read", "write")
	h.fail(member, "actor.call", map[string]any{"store": "catalog-data", "action": "removeApp", "args": map[string]any{"id": "weft"}}, "permission_denied")
	// A new release of weft: its version joins the history, it is newest.
	up := h.call(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "upsertApp", "args": map[string]any{
		"id": "weft", "title": "Weft", "description": "A shader language whose pixels are glyphs", "tags": []any{"shaders", "type"},
		"capabilities": []any{"sample"}, "free": true, "version": "1.1.0", "publishedAt": "2026-11-01T09:00:00Z", "bytes": 1100000,
		"open": "https://apps.example/f/weft/", "download": "/_s/weft/main/index.html"}}).(map[string]any)
	if up["created"] != false || up["rev"] != 2.0 {
		t.Fatalf("upsertApp: %v", up)
	}
	_, cat, hdr = getJSON("/catalog/api/catalog.json", nil)
	weft = cat["items"].([]any)[0].(map[string]any)
	if weft["id"] != "weft" || len(weft["releases"].([]any)) != 2 || hdr["Etag"][0] != `"c2"` {
		t.Fatalf("after upsert: %v %v", weft, hdr["Etag"])
	}
	if r, _ := h.raw("GET", live, "/catalog/api/catalog.json", nil, map[string]string{"If-None-Match": `"c1"`}); r.StatusCode != 200 {
		t.Fatalf("a stale ETag: %d", r.StatusCode)
	}
	// A bad item is refused whole, and nothing changes.
	h.fail(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "upsertApp", "args": map[string]any{
		"id": "evil", "title": "Evil", "free": true, "open": "javascript:alert(1)"}}, "invalid_argument")
	h.fail(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "importCatalog", "args": map[string]any{
		"items": []any{map[string]any{"id": "ok", "title": "OK", "free": true}, map[string]any{"id": "ok2", "free": true}}}}, "invalid_argument")
	if _, out, _ := getJSON("/catalog/api/apps", nil); out["total"] != 2.0 {
		t.Fatalf("after refused writes: %v", out)
	}
	// Removing an app takes its tags and releases with it.
	if out := h.call(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "removeApp", "args": map[string]any{"id": "mimeo"}}).(map[string]any); out["removed"] != true {
		t.Fatalf("removeApp: %v", out)
	}
	rows := h.call(admin, "sql.query", map[string]any{"store": "catalog-data", "sql": "SELECT (SELECT count(*) FROM releases WHERE app = 'mimeo') AS r, (SELECT count(*) FROM app_tags WHERE app = 'mimeo') AS t"}).([]any)
	if row := rows[0].(map[string]any); row["r"] != 0.0 || row["t"] != 0.0 {
		t.Fatalf("mimeo's rows: %v", row)
	}
	// importCatalog with prune makes the tables match the list.
	var fixture map[string]any
	_ = json.Unmarshal([]byte(catalogFixture), &fixture)
	out := h.call(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "importCatalog", "args": map[string]any{
		"items": fixture["items"].([]any)[1:], "prune": true}}).(map[string]any)
	if rm, _ := out["removed"].([]any); out["created"] != 1.0 || len(rm) != 1 || rm[0] != "weft" {
		t.Fatalf("prune: %v", out)
	}
	// The Curator and the CLI read through the catalog action.
	if c := h.call(admin, "actor.call", map[string]any{"store": "catalog-data", "action": "catalog"}).(map[string]any); c["count"] != 1.0 {
		t.Fatalf("catalog action: %v", c)
	}
}

func TestCatalogMCPEndpoint(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := deployCatalogData(t, h, admin)

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
	if code != 200 || res["protocolVersion"] != "2025-03-26" || res["serverInfo"].(map[string]any)["name"] != "slop-catalog" || !strings.Contains(fmtAny(res["instructions"]), "2 single-file") {
		t.Fatalf("initialize: %d %s", code, body)
	}
	if code, _, body := rpc(`{"jsonrpc":"2.0","method":"notifications/initialized"}`); code != 202 || body != "" {
		t.Fatalf("notification: %d %q", code, body)
	}
	_, _, body = rpc(`{"jsonrpc":"2.0","id":2,"method":"tools/list"}`)
	if !strings.Contains(body, `"search_apps"`) || !strings.Contains(body, `"readOnlyHint":true`) {
		t.Fatalf("tools/list: %s", body)
	}
	_, out, body = rpc(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_apps","arguments":{"query":"shader"}}}`)
	sc := out["result"].(map[string]any)["structuredContent"].(map[string]any)
	if sc["total"] != 1.0 || !strings.Contains(body, `\"id\": \"weft\"`) {
		t.Fatalf("search: %s", body)
	}
	_, out, _ = rpc(`{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_apps","arguments":{"capability":"room","free_only":true}}}`)
	if sc := out["result"].(map[string]any)["structuredContent"].(map[string]any); sc["total"] != 0.0 {
		t.Fatalf("search room+free: %v", sc)
	}
	_, _, body = rpc(`{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_app","arguments":{"id":"mimeo"}}}`)
	if !strings.Contains(body, `"access":"subscribers"`) || !strings.Contains(body, `"changelog":"first"`) || !strings.Contains(body, `"html":null`) ||
		!strings.Contains(body, `"viewer":"https://site.example/catalog/list/?open=mimeo"`) {
		t.Fatalf("get_app: %s", body)
	}
	_, out, _ = rpc(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_app","arguments":{"id":"nope"}}}`)
	if out["result"].(map[string]any)["isError"] != true {
		t.Fatalf("get_app nope: %v", out)
	}
	_, out, _ = rpc(`{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_capabilities","arguments":{}}}`)
	caps := out["result"].(map[string]any)["structuredContent"].(map[string]any)["capabilities"].([]any)
	if first := caps[0].(map[string]any); len(caps) != 2 || first["name"] != "sample" || first["apps"] != 2.0 {
		t.Fatalf("list_capabilities: %v", caps)
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
	// A GET says what this is, and where the rest of the catalog is.
	if r, body := h.get(live, "/catalog/mcp"); r.StatusCode != 405 || !strings.Contains(body, "streamable-http") || !strings.Contains(body, "/catalog/api/catalog.json") {
		t.Fatalf("GET: %d %s", r.StatusCode, body)
	}
	// The /catalog/mcp mount serves MCP's routes and nothing else.
	if r, body := h.get(live, "/catalog/mcp/catalog.json"); r.StatusCode != 404 {
		t.Fatalf("catalog.json under /catalog/mcp: %d %.200s", r.StatusCode, body)
	}
}
