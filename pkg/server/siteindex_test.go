package server

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// The site index lists every URL a visitor can reach: static routes, the
// listed records of record routes, the pages page-from routes admit; never
// private routes, the fallback, shadowed URLs or unlisted pages and records.
func TestSiteIndex(t *testing.T) {
	h := newHarness(t, store.RoleAdmin)
	manuel := h.signIn("manuel")
	tok := h.token(manuel.id(), store.ScopeRead, store.ScopeWrite)
	if code := manuel.do("PUT", "/api/projects/lab", map[string]any{"name": "The Lab"}, nil); code != 200 {
		t.Fatalf("project: %d", code)
	}
	page := func(id, title string, manifest map[string]any) {
		h.pushFiles(tok, id, map[string]any{"title": title, "kind": "page", "project": "lab"}, manifest,
			map[string]string{"index.html": "<!doctype html><html><head></head><body>" + id + "</body></html>"})
	}
	h.pushFiles(tok, "journal", map[string]any{"title": "Journal", "kind": "data", "type": "post", "project": "lab"}, nil, map[string]string{
		"posts/first.md":  "---\ntitle: The first post\ntags: [routing, slop]\n---\nHello\n",
		"posts/second.md": "---\ntitle: The second post\n---\nBody\n",
		"posts/draft.md":  "---\ntitle: Not yet\ndraft: true\n---\nWIP\n",
		"notes/other.md":  "---\ntitle: Not a post\n---\n"})
	h.pushFiles(tok, "catalog", map[string]any{"title": "Catalog", "kind": "data", "project": "lab"}, nil, map[string]string{
		"a.json": `{"title":"App A","visibility":"public"}`, "b.json": `{"title":"App B","visibility":"hidden"}`,
		"c.json": `{"title":"App C","visibility":"listed"}`, "d.json": `{"title":"App D","draft":"True"}`})
	page("home", "Home", nil)
	page("about", "About us", nil)
	page("post", "Post", map[string]any{"reads": map[string]string{"posts": "journal"}})
	page("entry", "Entry", nil)
	page("shadow", "Shadow", map[string]any{"reads": map[string]string{"posts": "journal"}})
	page("secret", "Secret", nil)
	page("missing", "Missing release", nil)
	page("release-one", "Release one", nil)
	page("release-two", "Release two", map[string]any{"listed": false})
	page("not-found", "Not found", nil)
	page("index", "Index", map[string]any{"reads": map[string]string{"pages": "$site"}})
	route := func(r map[string]any) {
		t.Helper()
		r["host"] = "site.test"
		if code := manuel.do("PUT", "/api/routes", r, nil); code != 200 {
			t.Fatalf("route %v: %d", r, code)
		}
	}
	route(map[string]any{"path": "/", "page": "home"})
	route(map[string]any{"path": "/about", "page": "about"})
	route(map[string]any{"path": "/journal/:slug", "page": "post", "record": "posts/{slug}.md"})
	route(map[string]any{"path": "/journal/second", "page": "shadow"}) // more specific: shadows the record route there
	route(map[string]any{"path": "/apps/:id", "page": "entry", "record": "{id}.json", "bindings": map[string]any{"catalog": map[string]any{"artifact": "catalog"}}})
	route(map[string]any{"path": "/secret", "page": "secret", "access": "admins"})
	route(map[string]any{"path": "/r/:page", "page": "missing", "pageFrom": "release-{page}"})
	route(map[string]any{"path": "/runs/:id", "page": "about"}) // cannot be enumerated
	route(map[string]any{"path": "*", "page": "not-found"})
	route(map[string]any{"path": "/index", "page": "index"})

	var rows []map[string]any
	if code := manuel.do("GET", "/api/site?host=site.test", nil, &rows); code != 200 {
		t.Fatalf("GET /api/site: %d", code)
	}
	got := []string{}
	byPath := map[string]map[string]any{}
	for _, r := range rows {
		got = append(got, r["path"].(string)+" "+r["kind"].(string)+" "+r["title"].(string))
		byPath[r["path"].(string)] = r
	}
	want := []string{
		"/ page Home",
		"/about page About us",
		"/apps/a record App A",
		"/apps/c record App C",
		"/index page Index",
		"/journal/first record The first post",
		"/journal/second page Shadow",
		"/r/one project-page Release one",
	}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Fatalf("site index:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	first := byPath["/journal/first"]
	rec, _ := first["record"].(map[string]any)
	if first["route"] != "/journal/:slug" || first["page"] != "post" || first["section"] != "journal" || first["depth"] != float64(2) ||
		first["project"] != "lab" || first["projectName"] != "The Lab" || rec == nil || rec["id"] != "first" || rec["body"] != nil || rec["html"] != nil {
		t.Fatalf("a record entry: %v", first)
	}
	if tags, _ := rec["tags"].([]any); len(tags) != 2 {
		t.Fatalf("record fields are kept: %v", rec)
	}
	if home := byPath["/"]; home["section"] != "" || home["depth"] != float64(0) || home["updated"] == "" {
		t.Fatalf("the home entry: %v", home)
	}

	// A page that reads $site gets the index in its boot data.
	code, body, _ := h.get("site.test", "/index", "")
	m := regexp.MustCompile(`<script type="application/json" id="slop-boot">(.*?)</script>`).FindStringSubmatch(body)
	if code != 200 || m == nil {
		t.Fatalf("/index: %d %s", code, body)
	}
	var boot struct {
		Data map[string][]map[string]any `json:"data"`
	}
	if err := json.Unmarshal([]byte(m[1]), &boot); err != nil || len(boot.Data["pages"]) != len(want) {
		t.Fatalf("boot data pages: %v %v", err, boot.Data["pages"])
	}

	// A new route shows up at once: publishing it invalidates the cache.
	route(map[string]any{"path": "/journal", "page": "about"})
	rows = nil
	manuel.do("GET", "/api/site?host=site.test", nil, &rows)
	found := false
	for _, r := range rows {
		found = found || r["path"] == "/journal"
	}
	if !found {
		t.Fatalf("a new route is missing from the index: %v", rows)
	}
	if code := manuel.do("GET", "/api/site?host=elsewhere.test", nil, nil); code != 400 {
		t.Fatalf("an unknown host: %d", code)
	}

	// Pushing a page that reads an unknown $ source warns.
	var res map[string]any
	body2 := map[string]any{"tree": map[string]string{"index.html": h.upload(tok, []byte("<p>x"))}, "manifest": map[string]any{"reads": map[string]string{"x": "$nope", "pages": "$site"}},
		"create": map[string]any{"title": "W", "kind": "page"}}
	if code := h.bearer(tok, "POST", "/api/artifacts/warned/versions", body2, &res); code != 201 {
		t.Fatalf("push: %d %v", code, res)
	}
	if w, _ := res["warnings"].([]any); len(w) != 1 || !strings.Contains(w[0].(string), "$nope is not a known source") {
		t.Fatalf("warnings: %v", res["warnings"])
	}
}
