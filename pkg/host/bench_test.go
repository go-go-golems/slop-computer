package host

// The bench (SLOP3-022, apps/bench): its actor makes app stores projects.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"
)

// fmtJSON is v as JSON, for looking for text in a decoded answer.
func fmtJSON(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// installBench pushes apps/bench as store "bench" and trusts it with the
// workshop module.
func installBench(t *testing.T, h *harness, admin string) {
	t.Helper()
	h.call(admin, "store.new", map[string]any{"id": "bench", "type": "bench"})
	h.call(admin, "files.push", map[string]any{"store": "bench", "files": appDir(t, "bench")})
	if st := h.call(admin, "app.status", map[string]any{"store": "bench"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("the bench is broken: %v", st)
	}
	h.call(admin, "app.trust", map[string]any{"app": "bench", "module": "workshop"})
}

// Phase 1: the bench lists the app stores the visitor may develop, opens
// one (its draft starts as main), reads its files, pushes edits to draft
// (changed files as text, the rest by hash; main never moves; the dev
// instance, once there is one, comes up on each push), and creates new
// app stores on draft.
func TestBenchProjects(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	h.call(admin, "store.new", map[string]any{"id": "jot", "type": "jot"})
	app := devApp()
	png, _ := base64.StdEncoding.DecodeString(onePNG)
	sum := sha256.Sum256(png)
	pngSum := hex.EncodeToString(sum[:])
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": append(files(app), map[string]any{"path": "logo.png", "sha256": pngSum, "size": len(png)}),
		"blobs": map[string]any{pngSum: onePNG}})
	app["logo.png"] = "" // in the tree; pushed back by hash

	// apps: jot is there, the bench and instances are not.
	h.call(admin, "store.new", map[string]any{"id": "jot-prod", "app": "jot", "type": "jot"})
	apps := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "apps", "args": map[string]any{}}).([]any)
	var jot map[string]any
	for _, a := range apps {
		m := a.(map[string]any)
		if m["id"] == "bench" || m["id"] == "jot-prod" {
			t.Fatalf("apps lists %v", m["id"])
		}
		if m["id"] == "jot" {
			jot = m
		}
	}
	if jot == nil || jot["refs"].(map[string]any)["main"] == nil || len(jot["instances"].([]any)) != 1 || jot["dev"] != "" {
		t.Fatalf("jot in apps = %v", jot)
	}

	// open: draft is made from main; the tree lists every file.
	o := act("open", map[string]any{"app": "jot"})
	refs := o["refs"].(map[string]any)
	if refs["draft"] == nil || refs["draft"] != refs["main"] {
		t.Fatalf("open refs = %v", refs)
	}
	sha, size := map[string]string{}, map[string]any{}
	for _, f := range o["files"].([]any) {
		m := f.(map[string]any)
		sha[m["path"].(string)], size[m["path"].(string)] = m["sha256"].(string), m["size"]
	}
	if len(sha) != len(app) || !strings.HasPrefix(o["dev"].(string), "jot-dev-") || o["devStatus"] != nil {
		t.Fatalf("open = %v", o)
	}

	// read: text files as text, binary ones named.
	r := act("read", map[string]any{"app": "jot", "at": "draft", "paths": []any{"index.html", "logo.png"}})
	if r["texts"].(map[string]any)["index.html"] != app["index.html"] || len(r["binary"].([]any)) != 1 {
		t.Fatalf("read = %v", r)
	}

	// sync: one file changed, one removed, the rest (the binary too) by hash
	// and size.
	var push []any
	for p := range app {
		switch p {
		case "index.html":
			push = append(push, map[string]any{"path": p, "text": "<!doctype html><title>jot</title><main><p>edited</p></main>"})
		case "app.js":
		default:
			push = append(push, map[string]any{"path": p, "sha256": sha[p], "size": size[p]})
		}
	}
	s := act("sync", map[string]any{"app": "jot", "files": push, "message": "bench: index.html -app.js"})
	n := num(s["n"])
	if n <= num(refs["draft"]) || len(s["files"].([]any)) != len(app)-1 || len(s["activated"].([]any)) != 0 {
		t.Fatalf("sync = %v", s)
	}
	if got := h.call(admin, "files.cat", map[string]any{"store": "jot", "at": "draft", "path": "index.html"}); !strings.Contains(got.(string), "edited") {
		t.Fatalf("draft index.html = %v", got)
	}
	if got := h.call(admin, "files.cat", map[string]any{"store": "jot", "at": "main", "path": "index.html"}); got != app["index.html"] {
		t.Fatalf("main moved: %v", got)
	}
	if got := h.call(admin, "files.cat", map[string]any{"store": "jot", "at": "draft", "path": "logo.png", "as": "base64"}).(map[string]any); got["sha256"] != sha["logo.png"] {
		t.Fatalf("the binary file changed: %v", got)
	}

	// With a dev instance, a sync reports where it is.
	dev := o["dev"].(string)
	h.call(admin, "store.new", map[string]any{"id": dev, "app": "jot", "type": "jot"})
	h.call(admin, "app.follow", map[string]any{"store": dev, "ref": "draft"})
	push = []any{
		map[string]any{"path": "sql/002.sql", "text": "CREATE TABLE tags (note TEXT);"},
		map[string]any{"path": "index.html", "text": "<!doctype html><title>jot</title><main><p>again</p></main>"},
	}
	for _, f := range s["files"].([]any) { // the tree the last sync answered with
		if m := f.(map[string]any); m["path"] != "index.html" {
			push = append(push, map[string]any{"path": m["path"], "sha256": m["sha256"], "size": m["size"]})
		}
	}
	s = act("sync", map[string]any{"app": "jot", "files": push})
	acts := s["activated"].([]any)
	if len(acts) != 1 || acts[0].(map[string]any)["store"] != dev || num(acts[0].(map[string]any)["n"]) != num(s["n"]) || acts[0].(map[string]any)["broken"] != "" {
		t.Fatalf("sync with a dev instance = %v", s)
	}

	// create: a new app store, only on draft.
	c := act("create", map[string]any{"id": "fresh", "files": []any{
		map[string]any{"path": "app.json", "text": `{"title":"Fresh","page":"index.html"}`},
		map[string]any{"path": "index.html", "text": "<!doctype html><title>fresh</title>"},
	}})
	if c["app"] != "fresh" {
		t.Fatalf("create = %v", c)
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "fresh"}).(map[string]any); refs["draft"] == nil || refs["main"] != nil {
		t.Fatalf("fresh refs = %v", refs)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "open", "args": map[string]any{"app": "Not An Id"}}, "invalid_argument")
}

// Phase 2: the bench makes the visitor's dev instance of an app (typed as
// its draft's app.json says, following draft; the same one next time) and
// frames a dev view of it, for a person on the bench's page, never for a
// token.
func TestBenchDevInstance(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/bench", "store": "bench"})
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(devApp()), "ref": "draft"})

	d := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "dev", "args": map[string]any{"app": "jot"}}).(map[string]any)
	id, st := d["id"].(string), d["status"].(map[string]any)
	if !strings.HasPrefix(id, "jot-dev-") || st["app"] != "jot" || st["ref"] != "draft" || st["broken"] != "" {
		t.Fatalf("dev = %v", d)
	}
	for _, x := range h.call(admin, "store.ls", map[string]any{"all": true}).([]any) {
		if m := x.(map[string]any); m["id"] == id && m["type"] != "jot" {
			t.Fatalf("the dev instance's type is %q, not app.json's", m["type"])
		}
	}
	if again := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "dev", "args": map[string]any{"app": "jot"}}).(map[string]any); again["id"] != id {
		t.Fatalf("a second dev = %v", again)
	}

	page, v := personView(t, h, "admin@example.com", "/bench")
	e := result(t, rpc(page, v, "slop.call", map[string]any{"action": "embed", "args": map[string]any{"app": "jot"}}))
	if src, _ := e["src"].(string); !strings.Contains(src, "/e/emb_") || e["dev"] != true || e["secret"] == "" {
		t.Fatalf("embed = %v", e)
	}
	if r := result(t, rpc(page, v, "slop.call", map[string]any{"action": "renew", "args": map[string]any{"view": e["view"]}})); r["view"] != e["view"] {
		t.Fatalf("renew = %v", r)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "embed", "args": map[string]any{"app": "jot"}}, "not_granted")
}

// Phase 3: a sync made from a draft that has moved since (a push from a
// terminal) pushes nothing and answers with the draft as it is; head says
// so between syncs; logs is the dev instance's log; resetDev drops the dev
// instance (and only it), and dev makes a fresh one.
func TestBenchOutsidePushesAndReset(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	app := devApp()
	app["actor.js"] = `defineActor({ setup(ctx) { console.warn('setup warns'); }, actions: { ping: { requires: 'view', run() { return 'pong'; } } } });`
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	o := act("open", map[string]any{"app": "jot"})
	base := num(o["refs"].(map[string]any)["draft"])
	if r := act("head", map[string]any{"app": "jot", "base": base}); r["files"] != nil {
		t.Fatalf("head at base = %v", r)
	}

	// Someone pushes to draft from a terminal.
	app["README.md"] = "pushed from a terminal"
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	if r := act("head", map[string]any{"app": "jot", "base": base}); r["files"] == nil || num(r["refs"].(map[string]any)["draft"]) <= base {
		t.Fatalf("head after an outside push = %v", r)
	}
	s := act("sync", map[string]any{"app": "jot", "base": base, "files": []any{map[string]any{"path": "app.json", "text": app["app.json"]}}})
	if s["conflict"] != true || num(s["n"]) <= base || len(s["files"].([]any)) != len(app) {
		t.Fatalf("sync from an old base = %v", s)
	}
	if got := h.call(admin, "files.cat", map[string]any{"store": "jot", "at": "draft", "path": "README.md"}); got != "pushed from a terminal" {
		t.Fatalf("the conflicting sync pushed: README.md = %v", got)
	}

	// The dev instance: its log, then a reset.
	dev := act("dev", map[string]any{"app": "jot"})["id"].(string)
	h.call(admin, "app.status", map[string]any{"store": dev}) // runs setup
	if l := act("logs", map[string]any{"app": "jot"}); !strings.Contains(fmtJSON(l["lines"]), "setup warns") {
		t.Fatalf("logs = %v", l)
	}
	if r := act("resetDev", map[string]any{"app": "jot"}); r["dropped"] != dev {
		t.Fatalf("resetDev = %v", r)
	}
	h.fail(admin, "app.status", map[string]any{"store": dev}, "not_found")
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); refs["draft"] == nil {
		t.Fatalf("the app lost its draft: %v", refs)
	}
	if again := act("dev", map[string]any{"app": "jot"}); again["id"] != dev || again["status"].(map[string]any)["ref"] != "draft" {
		t.Fatalf("dev after the reset = %v", again)
	}

	// A migration changed after the dev instance applied it: the instance
	// stays on its version; reset, and the fresh one under the same id
	// activates draft (the kernel forgets a deleted store's failures).
	app["sql/001.sql"] = "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT);"
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	draft := num(h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any)["draft"])
	if st := h.call(admin, "app.status", map[string]any{"store": dev}).(map[string]any); !strings.Contains(st["broken"].(string), "changed after it was applied") {
		t.Fatalf("a changed migration: %v", st)
	}
	act("resetDev", map[string]any{"app": "jot"})
	st := act("dev", map[string]any{"app": "jot"})["status"].(map[string]any)
	if st["broken"] != "" || num(st["n"]) != draft {
		t.Fatalf("the fresh dev instance = %v, want draft %d and not broken", st, draft)
	}
}

// Phase 4: the agent's app.* verbs read and seed the visitor's dev
// instance, never the app store or a production instance.
func TestBenchDevData(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args})
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.call(admin, "files.push", map[string]any{"store": "jot", "files": files(devApp()), "ref": "draft"})
	dev := act("dev", map[string]any{"app": "jot"}).(map[string]any)["id"].(string)

	act("seedDocs", map[string]any{"app": "jot", "coll": "pins", "id": "slug", "rows": []any{
		map[string]any{"slug": "a", "title": "First"}, map[string]any{"slug": "b", "title": "Second"}}})
	if docs := act("docs", map[string]any{"app": "jot", "coll": "pins"}).([]any); len(docs) != 2 {
		t.Fatalf("docs = %v", docs)
	}
	if d := act("doc", map[string]any{"app": "jot", "path": "pins/b"}).(map[string]any); !strings.Contains(fmtJSON(d), "Second") {
		t.Fatalf("doc = %v", d)
	}
	act("seedTable", map[string]any{"app": "jot", "table": "notes", "rows": []any{map[string]any{"id": "n1"}, map[string]any{"id": "n2"}}})
	if rows := act("sql", map[string]any{"app": "jot", "sql": "SELECT count(*) AS n FROM notes"}); !strings.Contains(fmtJSON(rows), `"n":2`) {
		t.Fatalf("sql = %v", rows)
	}
	// The data went to the dev instance only.
	if docs := h.call(admin, "docs.ls", map[string]any{"store": "jot", "coll": "pins"}).([]any); len(docs) != 0 {
		t.Fatalf("the app store got the seeded documents: %v", docs)
	}
	if docs := h.call(admin, "docs.ls", map[string]any{"store": dev, "coll": "pins"}).([]any); len(docs) != 2 {
		t.Fatalf("the dev instance has %v", docs)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "sql", "args": map[string]any{"app": "jot", "sql": "DELETE FROM notes"}}, "invalid_argument") // read-only
}
