package registry

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidRouteKey(t *testing.T) {
	for key, want := range map[string]bool{
		"GET /":                  true,
		"GET /feed.json":         true,
		"POST /api/items/:id":    true,
		"* /api/*":               true,
		"DELETE /a/:b/c/*":       true,
		"GET":                    false,
		"get /a":                 false,
		"FETCH /a":               false,
		"GET a":                  false,
		"GET /a//b":              false,
		"GET /a/*/b":             false,
		"GET /a/:":               false,
		"GET /a/:1x":             false,
		"GET /a/b*":              false,
		"GET /a?x=1":             false,
		"GET  /a":                false,
		"GET /a/:id/:id2/x.json": true,
	} {
		if got := ValidRouteKey(key); got != want {
			t.Errorf("ValidRouteKey(%q) = %v, want %v", key, got, want)
		}
	}
}

func TestCovers(t *testing.T) {
	for _, c := range []struct {
		allow, key string
		want       bool
	}{
		{"GET /api/*", "GET /api/feed.json", true},
		{"GET /api/*", "GET /api/items/:id", true},
		{"GET /api/*", "GET /api/*", true},
		{"GET /api/*", "GET /api", true}, // * binds the rest, which may be empty
		{"GET /api/*", "GET /other", false},
		{"GET /api/:x", "GET /api/feed.json", true},
		{"GET /api/:x", "GET /api/:id", true},
		{"GET /api/:x", "GET /api/*", false}, // the key serves deeper paths than the entry
		{"GET /api/:x", "GET /api/a/b", false},
		{"GET /api/feed.json", "GET /api/:x", false}, // a literal covers only itself
		{"GET /api/feed.json", "GET /api/feed.json", true},
		{"POST /api/*", "GET /api/x", false},
		{"GET /api/*", "HEAD /api/x", true}, // GET routes answer HEAD
		{"HEAD /api/*", "GET /api/x", false},
		{"* /api/*", "DELETE /api/x", true},
		{"* /api/*", "* /api/x", true},
		{"GET /api/*", "* /api/x", false}, // a key for any method needs an entry for any method
		{"GET /", "GET /", true},
		{"GET /*", "GET /", true},
		{"GET /", "GET /a", false},
	} {
		if got := Covers(c.allow, c.key); got != c.want {
			t.Errorf("Covers(%q, %q) = %v, want %v", c.allow, c.key, got, c.want)
		}
	}
}

func TestMatchPattern(t *testing.T) {
	p, score, ok := MatchPattern("/api/items/:id", "/api/items/7")
	if !ok || p["id"] != "7" || score != 5 {
		t.Fatalf("param = %v %d %v", p, score, ok)
	}
	if p, _, ok := MatchPattern("/files/*", "/files/a/b.txt"); !ok || p["*"] != "a/b.txt" {
		t.Fatalf("wildcard = %v %v", p, ok)
	}
	if p, _, ok := MatchPattern("/files/*", "/files"); !ok || p["*"] != "" {
		t.Fatalf("empty wildcard = %v %v", p, ok)
	}
	if _, _, ok := MatchPattern("/a/b", "/a"); ok {
		t.Fatal("shorter path matched")
	}
	if _, _, ok := MatchPattern("/", "/"); !ok {
		t.Fatal("root")
	}
}

func TestFloorOf(t *testing.T) {
	a := &MountAPI{Routes: []string{"* /api/*"}, Floors: []Floor{
		{Route: "POST /api/*", Min: "interact"},
		{Route: "GET /api/feed.json", Min: "public"},
		{Route: "GET /api/:x", Min: "admin"},
		{Route: "GET /api/members/*", Audience: "subscriber"},
	}}
	for key, want := range map[string]Floor{
		"GET /api/feed.json":     {Route: "GET /api/feed.json", Min: "public"}, // literal beats :x
		"GET /api/other":         {Route: "GET /api/:x", Min: "admin"},
		"POST /api/items":        {Route: "POST /api/*", Min: "interact"},
		"GET /api/a/b":           {Min: "view"}, // no floor: the default
		"GET /api/members/:id":   {Route: "GET /api/members/*", Min: "view", Audience: "subscriber"},
		"DELETE /api/items/:id":  {Min: "view"},
		"GET /api/members/x/y/z": {Route: "GET /api/members/*", Min: "view", Audience: "subscriber"},
	} {
		if got := a.FloorOf(key); got != want {
			t.Errorf("FloorOf(%q) = %+v, want %+v", key, got, want)
		}
	}
	a.DefaultMin = "interact"
	if got := a.FloorOf("GET /api/a/b"); got.Min != "interact" {
		t.Errorf("default min = %+v", got)
	}
	if MaxLevel("public", "view") != "view" || MaxLevel("admin", "view") != "admin" || MaxLevel("bogus", "view") != "bogus" {
		t.Error("MaxLevel")
	}
}

func TestValidateAPI(t *testing.T) {
	mw := func(name, cfg string) Middleware { return Middleware{Name: name, Config: json.RawMessage(cfg)} }
	good := MountAPI{Prefix: "/api", Routes: []string{"GET /api/*", "POST /api/items"},
		Floors:        []Floor{{Route: "GET /api/feed.json", Min: "public"}, {Route: "POST /api/*", Min: "interact", Audience: "member"}},
		Middleware:    []Middleware{mw("rateLimit", `{"per":"ip","limit":120,"window":"1m"}`), mw("rateLimit", `{"per":"visitor","limit":10}`), mw("cors", `{"origins":["https://a.example"]}`), mw("apiToken", `{}`)},
		ResponseTypes: []string{"application/json", "text/html"}, ForwardHeaders: []string{"Accept", "x-request-id"}, MaxBodyBytes: 4096}
	if err := ValidateAPI(&good); err != nil {
		t.Fatalf("good policy: %v", err)
	}
	if err := ValidateAPI(nil); err != nil {
		t.Fatalf("nil policy: %v", err)
	}
	for want, change := range map[string]func(a *MountAPI){
		"prefix":             func(a *MountAPI) { a.Prefix = "/api/:x" },
		"prefix is":          func(a *MountAPI) { a.Prefix = "/" },
		"at least one":       func(a *MountAPI) { a.Routes = nil },
		"not METHOD":         func(a *MountAPI) { a.Routes = []string{"GET api"} },
		"not under":          func(a *MountAPI) { a.Routes = []string{"GET /other/*"} },
		"floor route":        func(a *MountAPI) { a.Floors = []Floor{{Route: "x", Min: "view"}} },
		"neither":            func(a *MountAPI) { a.Floors = []Floor{{Route: "GET /api/x"}} },
		"min \"root\"":       func(a *MountAPI) { a.Floors = []Floor{{Route: "GET /api/x", Min: "root"}} },
		"audience \"vip\"":   func(a *MountAPI) { a.Floors = []Floor{{Route: "GET /api/x", Audience: "vip"}} },
		"audience \"store\"": func(a *MountAPI) { a.Floors = []Floor{{Route: "GET /api/x", Audience: "store"}} },
		"defaultMin":         func(a *MountAPI) { a.DefaultMin = "self" },
		"rateLimit, cors":    func(a *MountAPI) { a.Middleware = []Middleware{mw("csrf", `{}`)} },
		"unknown field": func(a *MountAPI) {
			a.Middleware = []Middleware{mw("cors", `{"origins":["https://a.example"],"allowCredentials":true}`)}
		},
		"per is":   func(a *MountAPI) { a.Middleware = []Middleware{mw("rateLimit", `{"per":"user","limit":1}`)} },
		"limit is": func(a *MountAPI) { a.Middleware = []Middleware{mw("rateLimit", `{"per":"ip","limit":0}`)} },
		"window is": func(a *MountAPI) {
			a.Middleware = []Middleware{mw("rateLimit", `{"per":"ip","limit":1,"window":"forever"}`)}
		},
		"listed twice": func(a *MountAPI) {
			a.Middleware = []Middleware{mw("apiToken", `{}`), mw("apiToken", `{"required":true}`)}
		},
		"origin":           func(a *MountAPI) { a.Middleware = []Middleware{mw("cors", `{"origins":["*"]}`)} },
		"response type":    func(a *MountAPI) { a.ResponseTypes = []string{"text/*"} },
		"never forwarded":  func(a *MountAPI) { a.ForwardHeaders = []string{"Cookie"} },
		"Authorization":    func(a *MountAPI) { a.ForwardHeaders = []string{"Authorization"} },
		"maxBodyBytes":     func(a *MountAPI) { a.MaxBodyBytes = MaxMaxBodyBytes + 1 },
		"maxResponseBytes": func(a *MountAPI) { a.MaxResponseBytes = -1 },
	} {
		a := good
		a.Floors, a.Middleware = append([]Floor{}, good.Floors...), append([]Middleware{}, good.Middleware...)
		change(&a)
		err := ValidateAPI(&a)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("%s: err = %v", want, err)
		}
	}
	d := good.WithDefaults()
	if d.DefaultMin != "view" || d.MaxResponseBytes != DefaultMaxResponseBytes || d.ForwardHeaders[0] != "accept" || d.MaxBodyBytes != 4096 {
		t.Errorf("defaults = %+v", d)
	}
	if rl := good.RateLimits(); len(rl) != 2 || rl[0].WindowDuration().Minutes() != 1 {
		t.Errorf("rate limits = %+v", rl)
	}
}
