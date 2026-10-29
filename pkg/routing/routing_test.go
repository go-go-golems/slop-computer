package routing

import (
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// The routes of the Workshop prototype's seed (sources/workshop/seed.js:553-570).
var seed = []store.Route{
	{Host: "slop.boutique", Path: "/", Page: "front-page"},
	{Host: "slop.boutique", Path: "/apps/:slug", Page: "app-page", Record: "experiments/{slug}.json"},
	{Host: "slop.boutique", Path: "/pricing", Page: "pricing"},
	{Host: "slop.boutique", Path: "/about", Page: "about"},
	{Host: "slop.boutique", Path: "/journal", Page: "journal-index"},
	{Host: "slop.boutique", Path: "/journal/:slug", Page: "journal-post", Record: "posts/{slug}.md"},
	{Host: "slop.boutique", Path: "/play/orbits", Page: "orbits"},
	{Host: "slop.boutique", Path: "*", Page: "not-found"},
	{Host: "slop.computer", Path: "/watch/*", Page: "watch"},
}

func TestResolve(t *testing.T) {
	cases := []struct{ host, path, page, record string }{
		{"slop.boutique", "/", "front-page", ""},
		{"slop.boutique", "/journal", "journal-index", ""},
		{"slop.boutique", "/journal/routes-not-templates", "journal-post", "posts/routes-not-templates.md"},
		{"slop.boutique", "/apps/orbits", "app-page", "experiments/orbits.json"},
		{"slop.boutique", "/apps/orbits/extra", "not-found", ""},
		{"slop.boutique", "/nowhere", "not-found", ""},
		{"slop.computer", "/watch/pricing/7", "watch", ""},
	}
	for _, c := range cases {
		res, ok := Resolve(seed, c.host, c.path)
		if !ok || res.Route.Page != c.page || res.Record != c.record {
			t.Errorf("%s%s → %+v %v, want %s %s", c.host, c.path, res, ok, c.page, c.record)
		}
	}
	if _, ok := Resolve(seed, "other.host", "/"); ok {
		t.Error("other hosts must not match")
	}
	res, _ := Resolve(seed, "slop.computer", "/watch/pricing/7")
	if res.Params["*"] != "pricing/7" {
		t.Errorf("rest param %v", res.Params)
	}
	if p, ok := Match("/journal/:slug", "/journal/a%20b"); !ok || p["slug"] != "a b" {
		t.Errorf("unescape %v", p)
	}
	if Specificity("/journal/:slug") <= Specificity("/journal/*") || Specificity("/journal") <= Specificity("/:x") {
		t.Error("specificity order")
	}
}

func TestPageFrom(t *testing.T) {
	rows := []store.Route{
		{Host: "site", Path: "/r/:page", Page: "release-missing", PageFrom: "{page}"},
		{Host: "site", Path: "/x/:id", Page: "release-missing", PageFrom: "release-{id}"},
		{Host: "site", Path: "/r/feed", Page: "feed"},
	}
	cases := []struct{ path, page string }{
		{"/r/weft", "weft"},
		{"/x/weft", "release-weft"},
		{"/r/feed", "feed"},
	}
	for _, c := range cases {
		res, ok := Resolve(rows, "site", c.path)
		if !ok || res.Page != c.page {
			t.Errorf("%s → %+v %v, want page %s", c.path, res, ok, c.page)
		}
	}
	m := TemplateMatcher("release-{id}")
	if !m.MatchString("release-weft") || m.MatchString("weft") || m.MatchString("release-") {
		t.Errorf("matcher %s", m)
	}
	if !TemplateMatcher("{page}").MatchString("weft") || TemplateMatcher("a.{x}").MatchString("abx") {
		t.Error("matcher quoting")
	}
	// No :page makes {page}-{page} into private-draft; repeats match nothing.
	for _, id := range []string{"private-draft", "a-a", ""} {
		if TemplateMatcher("{page}-{page}").MatchString(id) {
			t.Errorf("repeated placeholder admitted %q", id)
		}
	}
	if !TemplateMatcher("{a}-{b}").MatchString("private-draft") {
		t.Error("distinct placeholders are independent")
	}
}

func TestRecordMatcherAndFillPath(t *testing.T) {
	re, names := RecordMatcher("posts/{slug}.md")
	m := re.FindStringSubmatch("posts/routes-not-templates.md")
	if len(m) != 2 || m[1] != "routes-not-templates" || len(names) != 1 || names[0] != "slug" {
		t.Fatalf("posts/{slug}.md: %v %v", m, names)
	}
	for _, p := range []string{"posts/a/b.md", "posts/x.json", "other/x.md"} {
		if re.MatchString(p) {
			t.Fatalf("%s should not match", p)
		}
	}
	if re, _ := RecordMatcher("{a}/{a}.md"); re.MatchString("x/x.md") {
		t.Fatal("a repeated placeholder matches nothing")
	}
	re, names = RecordMatcher("{year}/{slug}.json")
	if m := re.FindStringSubmatch("2026/hello.json"); len(m) != 3 || m[1] != "2026" || m[2] != "hello" || names[1] != "slug" {
		t.Fatalf("two placeholders: %v %v", m, names)
	}
	for _, c := range []struct {
		pattern string
		params  map[string]string
		want    string
		ok      bool
	}{
		{"/journal/:slug", map[string]string{"slug": "routes-not-templates"}, "/journal/routes-not-templates", true},
		{"/about", nil, "/about", true},
		{"/", nil, "/", true},
		{"/r/:page", map[string]string{"page": "a b"}, "/r/a%20b", true},
		{"/journal/:slug", map[string]string{}, "", false},
		{"/journal/:slug", map[string]string{"slug": "a/b"}, "", false},
		{"/files/*", nil, "", false},
	} {
		got, ok := FillPath(c.pattern, c.params)
		if got != c.want || ok != c.ok {
			t.Fatalf("FillPath(%s, %v) = %q, %v", c.pattern, c.params, got, ok)
		}
	}
}
