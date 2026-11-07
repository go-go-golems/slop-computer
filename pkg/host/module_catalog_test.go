package host

// SLOP3-012 part 2 (phase 5a): the module catalog and grants with a
// configuration.

import (
	"context"
	"strings"
	"testing"

	"github.com/dop251/goja"

	"github.com/go-go-golems/slop-computer/pkg/actor"
	"github.com/go-go-golems/slop-computer/pkg/apps"
)

const catalogActor = `
const db = require('database');
defineActor({
  actions: {
    add(ctx, { name }) { return db.exec('INSERT INTO items (name) VALUES (?)', name).rowsAffected; },
    count() { return db.query('SELECT count(*) AS n FROM items')[0].n; },
    all() { return db.query('SELECT name FROM items').length; },
  },
});
`

func catalogApp(t *testing.T, h *harness, admin, id string) {
	t.Helper()
	h.call(admin, "store.new", map[string]any{"id": id})
	h.call(admin, "files.push", map[string]any{"store": id, "files": files(map[string]string{
		"app.json":          `{"title":"Cat","actor":"actor.js"}`,
		"actor.js":          catalogActor,
		"sql/001_items.sql": "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT);",
	})})
}

func TestModuleCatalog(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	catalogApp(t, h, admin, "cat")

	// The catalog: every module with its class, config schema and types.
	out := h.call(admin, "app.modules", map[string]any{}).(map[string]any)
	byName := map[string]map[string]any{}
	for _, m := range out["modules"].([]any) {
		row := m.(map[string]any)
		byName[row["name"].(string)] = row
	}
	for name, class := range map[string]string{"database": "own", "express": "own", "system": "trusted", "workshop": "trusted"} {
		if byName[name] == nil || byName[name]["class"] != class {
			t.Fatalf("%s: %v", name, byName[name])
		}
	}
	schema, _ := byName["database"]["config"].(map[string]any)
	props, _ := schema["properties"].(map[string]any)
	if props["readOnly"] == nil || props["maxRows"] == nil || schema["additionalProperties"] != false {
		t.Fatalf("database config schema: %v", schema)
	}
	if ts, _ := byName["express"]["typescript"].(string); !strings.Contains(ts, `declare module "express"`) {
		t.Fatalf("express typescript: %q", ts)
	}
	// Every trusted module is one app.json may declare, and no other.
	for _, m := range h.a.Modules() {
		if (m.Class == "trusted") != apps.Modules[m.Name] {
			t.Fatalf("%s: class %s, declarable %v", m.Name, m.Class, apps.Modules[m.Name])
		}
	}

	// On by default: no grant, read-write.
	if n := h.call(admin, "actor.call", map[string]any{"store": "cat", "action": "add", "args": map[string]any{"name": "a"}}); n != 1.0 {
		t.Fatalf("add: %v", n)
	}

	// Configurations are decoded strictly and validated before they are stored.
	for cfg, want := range map[string]map[string]any{
		"no field \"readonly\"": {"readonly": true},
		"maxRows":               {"maxRows": 20000},
	} {
		e := h.fail(admin, "app.trust", map[string]any{"app": "cat", "module": "database", "config": want}, "invalid_argument")
		if !strings.Contains(e["message"].(string), cfg) {
			t.Fatalf("config %v: %v", want, e)
		}
	}
	h.fail(admin, "app.trust", map[string]any{"app": "cat", "module": "express", "config": map[string]any{"x": 1}}, "invalid_argument")
	h.fail(admin, "app.trust", map[string]any{"app": "cat", "module": "nope"}, "invalid_argument")

	// A grant configures it: read-only, at most one row. ada makes it, then
	// stops being an admin; the restriction stays.
	h.tokenFor("ada@example.com")
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ada@example.com"), "role": "admin"})
	ada := h.tokenFor("ada@example.com", "read", "write", "admin")
	got := h.call(ada, "app.trust", map[string]any{"app": "cat", "module": "database", "config": map[string]any{"readOnly": true, "maxRows": 1}}).(map[string]any)
	if c, _ := got["config"].(map[string]any); c["readOnly"] != true || c["maxRows"] != 1.0 {
		t.Fatalf("app.trust: %v", got)
	}
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ada@example.com"), "role": "member"})
	h.a.Restart("cat")
	h.fail(admin, "actor.call", map[string]any{"store": "cat", "action": "add", "args": map[string]any{"name": "b"}}, "permission_denied")
	if n := h.call(admin, "actor.call", map[string]any{"store": "cat", "action": "count"}); n != 1.0 {
		t.Fatalf("count: %v", n)
	}
	trusted := h.call(admin, "app.modules", map[string]any{"app": "cat"}).(map[string]any)
	row := trusted["trusted"].([]any)[0].(map[string]any)
	if row["module"] != "database" || row["current"] != false || !strings.Contains(row["config"].(string), "readOnly") {
		t.Fatalf("grant after demotion: %v", row)
	}
	if calls, _ := trusted["calls"].(map[string]any); calls["database"].(float64) < 2 {
		t.Fatalf("calls: %v", trusted["calls"])
	}

	// maxRows: a query over the limit throws.
	h.call(admin, "app.trust", map[string]any{"app": "cat", "module": "database", "config": map[string]any{"maxRows": 1}})
	h.call(admin, "actor.call", map[string]any{"store": "cat", "action": "add", "args": map[string]any{"name": "b"}})
	h.fail(admin, "actor.call", map[string]any{"store": "cat", "action": "all"}, "invalid_argument")

	// Untrust returns it to its default configuration.
	h.call(admin, "app.untrust", map[string]any{"app": "cat", "module": "database"})
	if n := h.call(admin, "actor.call", map[string]any{"store": "cat", "action": "all"}); n != 2.0 {
		t.Fatalf("after untrust: %v", n)
	}

	// A stored configuration that no longer decodes fails closed.
	if err := h.k.Gov.TrustModule(context.Background(), "system", "test", "cat", "database", `{"gone":true}`); err != nil {
		t.Fatal(err)
	}
	h.a.Restart("cat")
	e := h.fail(admin, "actor.call", map[string]any{"store": "cat", "action": "count"}, "actor_error")
	if !strings.Contains(e["message"].(string), "grant it again") {
		t.Fatalf("stale config: %v", e)
	}
	// Doing as the message says repairs it, with no manual restart: the
	// grant's restart forgets the failed build.
	h.call(admin, "app.trust", map[string]any{"app": "cat", "module": "database", "config": map[string]any{}})
	if n := h.call(admin, "actor.call", map[string]any{"store": "cat", "action": "count"}); n != 2.0 {
		t.Fatalf("after granting it again: %v", n)
	}
}

// The interceptor: a scoped module's calls find its grant still current on
// every call, without a restart, and are counted.
func TestModuleInterceptor(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.a.Register(actor.Module{Name: "probe", Class: actor.ClassScoped, Doc: "test",
		Load: func(s actor.Setup) goja.Value {
			o := s.Actor.VM().NewObject()
			_ = o.Set("ping", func() string { return "pong" })
			inner := s.Actor.VM().NewObject()
			_ = inner.Set("deep", func() int { return 7 })
			_ = o.Set("inner", inner)
			return o
		}})
	h.call(admin, "store.new", map[string]any{"id": "pr"})
	h.call(admin, "files.push", map[string]any{"store": "pr", "files": files(map[string]string{
		"app.json": `{"title":"Probe","actor":"actor.js"}`,
		"actor.js": `const p = use('probe');
defineActor({ actions: {
  has() { return p !== null; },
  ping() { return p.ping() + p.inner.deep(); },
} });`,
	})})
	if got := h.call(admin, "actor.call", map[string]any{"store": "pr", "action": "has"}); got != false {
		t.Fatalf("before a grant: %v", got)
	}
	h.tokenFor("ada@example.com")
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ada@example.com"), "role": "admin"})
	ada := h.tokenFor("ada@example.com", "read", "write", "admin")
	h.call(ada, "app.trust", map[string]any{"app": "pr", "module": "probe"})
	if got := h.call(admin, "actor.call", map[string]any{"store": "pr", "action": "ping"}); got != "pong7" {
		t.Fatalf("granted: %v", got)
	}
	if n := h.a.ModuleCalls("pr")["probe"]; n != 2 {
		t.Fatalf("calls = %d", n)
	}
	// ada is demoted: the next call is refused, with no restart between.
	h.call(admin, "people.role", map[string]any{"id": personID(t, h, "ada@example.com"), "role": "member"})
	e := h.fail(admin, "actor.call", map[string]any{"store": "pr", "action": "ping"}, "permission_denied")
	if !strings.Contains(e["message"].(string), "no longer trusted with probe") {
		t.Fatalf("after demotion: %v", e)
	}
}
