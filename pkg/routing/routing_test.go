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
