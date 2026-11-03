package host

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
)

// TestBenchPageDBQuery measures a page's db.query and db.get, on its own
// store and through an alias, calling the RPC handlers directly (no HTTP):
// SLOP3-009 step 4 compares them before and after pkg/caps/db. It runs only
// with SLOP_BENCH=1.
func TestBenchPageDBQuery(t *testing.T) {
	if os.Getenv("SLOP_BENCH") == "" {
		t.Skip("set SLOP_BENCH=1")
	}
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "view"})
	pageApp(h, admin, "dash", "/dash", `{}`)
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})
	for i := range 100 {
		h.call(admin, "docs.set", map[string]any{"store": "crm", "path": fmt.Sprintf("contacts/c%03d", i), "data": map[string]any{"n": i}})
		h.call(admin, "docs.set", map[string]any{"store": "dash", "path": fmt.Sprintf("notes/n%03d", i), "data": map[string]any{"n": i}})
	}
	s := h.site(h.cfg.Hosts.Live[0])
	vm := guestView(t, s, "/dash")
	v := vm["view"].(string)
	ctx := context.Background()
	cases := []struct {
		name string
		run  func() (any, error)
	}{
		{"query-own", func() (any, error) {
			return h.srv.Pages.RunMethod(ctx, v, "db.query", json.RawMessage(`{"coll":"notes","limit":20}`))
		}},
		{"query-alias", func() (any, error) {
			return h.srv.Pages.RunMethod(ctx, v, "db.query", json.RawMessage(`{"coll":"contacts","limit":20}`))
		}},
		{"get-own", func() (any, error) {
			return h.srv.Pages.RunMethod(ctx, v, "db.get", json.RawMessage(`{"path":"notes/n042"}`))
		}},
		{"get-alias", func() (any, error) {
			return h.srv.Pages.RunMethod(ctx, v, "db.get", json.RawMessage(`{"path":"contacts/c042"}`))
		}},
	}
	for _, c := range cases {
		if _, err := c.run(); err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		r := testing.Benchmark(func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				if _, err := c.run(); err != nil {
					b.Fatal(err)
				}
			}
		})
		t.Logf("%-12s %s %s", c.name, r.String(), r.MemString())
	}
}
