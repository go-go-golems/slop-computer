package host

// SLOP3-009 step 2: typed verbs through the HTTP API.

import (
	"encoding/json"
	"strings"
	"testing"
)

// A typed verb works through the API as before, refuses arguments it does
// not have, and the verb listing carries its schemas.
func TestTypedVerbsOverTheAPI(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "library"})
	for id, year := range map[string]float64{"a": 1999, "b": 2004, "c": 2011} {
		h.call(admin, "docs.set", map[string]any{"store": "library", "path": "books/" + id, "data": map[string]any{"year": year, "lang": "en"}})
	}
	// both where forms, ordering, a limit
	got := h.call(admin, "docs.query", map[string]any{"store": "library", "coll": "books",
		"where":   []any{[]any{"year", ">=", 2000}, map[string]any{"field": "lang", "op": "==", "value": "en"}},
		"orderBy": "year", "desc": true, "limit": 1}).([]any)
	if len(got) != 1 || got[0].(map[string]any)["path"] != "books/c" {
		t.Fatalf("docs.query: %v", got)
	}
	// arguments the verb does not have, at the top or nested
	e := h.fail(admin, "grant.set", map[string]any{"store": "library", "subject": "@guest", "level": "view", "levle": "x"}, "invalid_argument")
	if !strings.Contains(e["message"].(string), "levle") {
		t.Fatalf("unknown argument: %v", e)
	}
	h.fail(admin, "docs.query", map[string]any{"store": "library", "coll": "books", "where": []any{[]any{"year", ">="}}}, "invalid_argument")
	// a well-formed grant still works, and returns the grant
	g := h.call(admin, "grant.set", map[string]any{"store": "library", "subject": "@guest", "level": "view"}).(map[string]any)
	if g["store"] != "library" || g["level"] != "view" {
		t.Fatalf("grant.set: %v", g)
	}
	// the listing carries schemas and effects
	r, body := h.get(h.cfg.Hosts.Main, "/api/v1/verbs")
	if r.StatusCode != 200 {
		t.Fatalf("verbs: %d", r.StatusCode)
	}
	var list struct {
		Verbs []struct {
			Name   string          `json:"name"`
			Effect string          `json:"effect"`
			Input  json.RawMessage `json:"input"`
			Output json.RawMessage `json:"output"`
		} `json:"verbs"`
	}
	if err := json.Unmarshal([]byte(body), &list); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, v := range list.Verbs {
		switch v.Name {
		case "grant.set", "docs.query", "mount.set":
			if len(v.Input) == 0 || len(v.Output) == 0 {
				t.Fatalf("%s listed without schemas", v.Name)
			}
			seen[v.Name] = true
		case "people.role":
			if v.Effect != "govern" {
				t.Fatalf("people.role effect %q", v.Effect)
			}
		}
	}
	if len(seen) != 3 {
		t.Fatalf("typed verbs listed: %v", seen)
	}
}
