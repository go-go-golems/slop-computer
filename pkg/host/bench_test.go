package host

// The bench (SLOP3-022, apps/bench): its actor makes app stores projects.

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"testing"

	"github.com/go-go-golems/slop-computer/pkg/client"
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
	h.push(admin, map[string]any{"store": "bench", "files": appDir(t, "bench")})
	if st := h.call(admin, "app.status", map[string]any{"store": "bench"}).(map[string]any); st["broken"] != "" {
		t.Fatalf("the bench is broken: %v", st)
	}
	h.call(admin, "app.trust", map[string]any{"app": "bench", "module": "workshop"})
}

// The bench (SLOP3-022, SLOP3-023): files at snapshot numbers, commits of
// change lists against a base (merged per file on the server; a conflict
// comes back as a value and writes nothing), each commit on the person's
// timeline; the person's instances by kind; proposals as refs; the
// person's records in the bench's SQL.
func TestBenchFiles(t *testing.T) {
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
	h.push(admin, map[string]any{"store": "jot", "files": append(files(app), map[string]any{"path": "logo.png", "sha256": pngSum, "size": len(png)}),
		"blobs": map[string]any{pngSum: onePNG}})

	// apps: jot is there, the bench and instances are not.
	h.call(admin, "store.new", map[string]any{"id": "jot-prod", "app": "jot", "type": "jot"})
	var jot map[string]any
	for _, a := range h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "apps", "args": map[string]any{}}).([]any) {
		m := a.(map[string]any)
		if m["id"] == "bench" || m["id"] == "jot-prod" {
			t.Fatalf("apps lists %v", m["id"])
		}
		if m["id"] == "jot" {
			jot = m
		}
	}
	if jot == nil || jot["refs"].(map[string]any)["main"] == nil || len(jot["instances"].([]any)) != 1 {
		t.Fatalf("jot in apps = %v", jot)
	}

	// open: draft is made from main; the visitor's instance ids.
	o := act("open", map[string]any{"app": "jot"})
	refs := o["refs"].(map[string]any)
	if refs["draft"] == nil || refs["draft"] != refs["main"] || !strings.HasPrefix(o["mine"].(map[string]any)["dev"].(string), "jot-dev-") {
		t.Fatalf("open = %v", o)
	}
	n1 := num(refs["draft"])
	if r := act("head", map[string]any{"app": "jot", "ref": "draft"}); num(r["n"]) != n1 {
		t.Fatalf("head = %v", r)
	}
	// The bench reads at numbers and commits to draft and proposals only.
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "head", "args": map[string]any{"app": "jot", "ref": "main"}}, "invalid_argument")
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "files", "args": map[string]any{"app": "jot", "at": "draft"}}, "invalid_argument")
	listing := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "files", "args": map[string]any{"app": "jot", "at": n1}}).([]any)
	if len(listing) != len(app)+1 || !strings.Contains(fmtJSON(listing), pngSum) {
		t.Fatalf("files = %v", listing)
	}
	rd := act("read", map[string]any{"app": "jot", "at": n1, "paths": []any{"index.html", "logo.png"}})
	if rd["texts"].(map[string]any)["index.html"] != app["index.html"] || fmtJSON(rd["binary"]) != `["logo.png"]` {
		t.Fatalf("read = %v", rd)
	}

	// A clean commit: the change list, a removal, the new listing, the event.
	c := act("commit", map[string]any{"app": "jot", "ref": "draft", "base": n1, "message": "edit",
		"changes": []any{map[string]any{"path": "README.md", "text": "mine"}, map[string]any{"path": "app.js", "delete": true}},
		"event":   map[string]any{"who": "agent", "thread": "th1", "note": "eval 1"}})
	n2 := num(c["n"])
	if n2 <= n1 || num(c["at"]) != n1 || c["merged"] != false || !strings.Contains(fmtJSON(c["files"]), "README.md") || strings.Contains(fmtJSON(c["files"]), `"app.js"`) {
		t.Fatalf("commit = %v", c)
	}
	if e := c["event"].(map[string]any); e["kind"] != "commit" || num(e["n"]) != n2 || e["who"] != "agent" || e["thread"] != "th1" || fmtJSON(e["paths"]) != `["README.md","app.js"]` {
		t.Fatalf("the commit's event = %v", e)
	}
	// Someone commits elsewhere; a commit from the older base merges over it.
	h.commit(admin, map[string]any{"store": "jot", "ref": "draft", "changes": []any{map[string]any{"path": "b.txt", "text": "outside"}}})
	m := act("commit", map[string]any{"app": "jot", "ref": "draft", "base": n2, "changes": []any{map[string]any{"path": "README.md", "text": "mine again"}}})
	if m["merged"] != true || !strings.Contains(fmtJSON(m["files"]), "b.txt") {
		t.Fatalf("a commit over someone else's = %v", m)
	}
	// Both change the same file: a conflict, as a value, and nothing written.
	h.commit(admin, map[string]any{"store": "jot", "ref": "draft", "changes": []any{map[string]any{"path": "README.md", "text": "theirs"}}})
	at := h.refAt(admin, "jot", "draft")
	k := act("commit", map[string]any{"app": "jot", "ref": "draft", "base": num(m["n"]), "changes": []any{map[string]any{"path": "README.md", "text": "mine, third"}}})
	if fmtJSON(k["conflict"]) != fmt.Sprintf(`{"at":%d,"paths":["README.md"]}`, at) || h.refAt(admin, "jot", "draft") != at {
		t.Fatalf("a conflicting commit = %v", k)
	}
	// A file kept by hash (a copy of logo.png, as files.copy and accepting
	// a proposal send it) arrives as that blob, not as text.
	cp := act("commit", map[string]any{"app": "jot", "ref": "draft", "base": at,
		"changes": []any{map[string]any{"path": "img/copy.png", "sha256": pngSum, "size": len(png), "type": "image/png"}}})
	if !strings.Contains(fmtJSON(cp["files"]), `"path":"img/copy.png","sha256":"`+pngSum+`"`) {
		t.Fatalf("a commit of a file kept by hash = %v", cp)
	}
	// A change that is none of the kinds fails; it does not become a file.
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "commit", "args": map[string]any{"app": "jot", "ref": "draft", "base": num(cp["n"]),
		"changes": []any{map[string]any{"path": "x.txt"}}}}, "invalid_argument")
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "commit", "args": map[string]any{"app": "jot", "ref": "draft", "base": num(cp["n"]),
		"changes": []any{map[string]any{"text": "no path"}}}}, "invalid_argument")
	// The timeline has the three bench commits, numbered.
	p := act("project", map[string]any{"app": "jot"})
	evs := p["events"].([]any)
	if len(evs) != 3 || num(evs[0].(map[string]any)["seq"]) != 1 || num(evs[2].(map[string]any)["seq"]) != 3 || p["meta"] != nil {
		t.Fatalf("project = %v", p)
	}
}

// A new app: a store, its first files committed to draft; no main yet.
func TestBenchCreate(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	r := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "create", "args": map[string]any{"id": "fresh", "type": "fresh",
		"files": []any{map[string]any{"path": "app.json", "text": `{"title":"Fresh","page":"index.html"}`}, map[string]any{"path": "index.html", "text": "<p>hi</p>"}}}}).(map[string]any)
	refs := h.call(admin, "ref.ls", map[string]any{"store": "fresh"}).(map[string]any)
	if num(r["n"]) == 0 || num(refs["draft"]) != num(r["n"]) || refs["main"] != nil {
		t.Fatalf("create = %v, refs %v", r, refs)
	}
	if got := h.call(admin, "files.cat", map[string]any{"store": "fresh", "at": "draft", "path": "index.html"}); got != "<p>hi</p>" {
		t.Fatalf("index.html = %v", got)
	}
	// The first snapshot opens the creator's timeline.
	p := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "project", "args": map[string]any{"app": "fresh"}}).(map[string]any)
	evs := p["events"].([]any)
	if len(evs) != 1 || evs[0].(map[string]any)["kind"] != "commit" || evs[0].(map[string]any)["ref"] != "draft" || num(evs[0].(map[string]any)["n"]) != num(r["n"]) {
		t.Fatalf("the new app's timeline = %v", evs)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "create", "args": map[string]any{"id": "bad", "files": []any{map[string]any{"path": "a.txt", "delete": true}}}}, "invalid_argument")
}

// The visitor's instances: dev follows draft and comes up on each commit;
// embeds of it for the page; its log; a reset drops it (and only it).
func TestBenchInstances(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/bench", "store": "bench"})
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	app := devApp()
	app["actor.js"] = `defineActor({ setup(ctx) { console.warn('setup warns'); }, actions: { ping: { requires: 'view', run() { return 'pong'; } } } });`
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	draft := h.refAt(admin, "jot", "draft")

	d := act("instance", map[string]any{"app": "jot", "kind": "dev"})
	id := d["id"].(string)
	if !strings.HasPrefix(id, "jot-dev-") || d["ref"] != "draft" || num(d["n"]) != draft || d["broken"] != "" {
		t.Fatalf("instance dev = %v", d)
	}
	for _, x := range h.call(admin, "store.ls", map[string]any{"all": true}).([]any) {
		if m := x.(map[string]any); m["id"] == id && m["type"] != "jot" {
			t.Fatalf("the dev instance's type is %q, not app.json's", m["type"])
		}
	}
	if again := act("instance", map[string]any{"app": "jot", "kind": "dev"}); again["id"] != id {
		t.Fatalf("a second instance = %v", again)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "instance", "args": map[string]any{"app": "jot", "kind": "prod"}}, "invalid_argument")
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "instance", "args": map[string]any{"app": "jot", "kind": "prop"}}, "invalid_argument")

	// A commit brings the dev instance up on the new snapshot.
	c := act("commit", map[string]any{"app": "jot", "ref": "draft", "base": draft, "changes": []any{map[string]any{"path": "README.md", "text": "x"}}})
	if a := fmtJSON(c["activated"]); !strings.Contains(a, `"store":"`+id+`"`) || !strings.Contains(a, fmt.Sprintf(`"n":%d`, num(c["n"]))) {
		t.Fatalf("activated = %v", c["activated"])
	}
	st := act("status", map[string]any{"app": "jot"})
	if dev := st["dev"].(map[string]any); dev["id"] != id || num(dev["n"]) != num(c["n"]) || st["test"] != nil || len(st["props"].([]any)) != 0 {
		t.Fatalf("status = %v", st)
	}

	// Embeds are for the page (a person's view), not tokens.
	page, v := personView(t, h, "admin@example.com", "/bench")
	e := result(t, rpc(page, v, "slop.call", map[string]any{"action": "embed", "args": map[string]any{"app": "jot", "kind": "dev"}}))
	if src, _ := e["src"].(string); !strings.Contains(src, "/e/emb_") || e["dev"] != true || e["secret"] == "" {
		t.Fatalf("embed = %v", e)
	}
	if r := result(t, rpc(page, v, "slop.call", map[string]any{"action": "renew", "args": map[string]any{"view": e["view"]}})); r["view"] != e["view"] {
		t.Fatalf("renew = %v", r)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "embed", "args": map[string]any{"app": "jot", "kind": "dev"}}, "not_granted")
	if c := result(t, rpc(page, v, "slop.call", map[string]any{"action": "close", "args": map[string]any{"view": e["view"]}})); c["closed"] != e["view"] {
		t.Fatalf("close = %v", c)
	}
	u, _ := url.Parse(e["src"].(string))
	if r, _ := h.get(u.Host, u.RequestURI()); r.StatusCode != 404 {
		t.Fatalf("the closed embed's address answers %d", r.StatusCode)
	}

	// Its log, then a reset: the instance goes, the app keeps its draft.
	if l := act("logs", map[string]any{"app": "jot", "kind": "dev"}); !strings.Contains(fmtJSON(l["lines"]), "setup warns") {
		t.Fatalf("logs = %v", l)
	}
	if r := act("reset", map[string]any{"app": "jot", "kind": "dev"}); r["dropped"] != id {
		t.Fatalf("reset = %v", r)
	}
	h.fail(admin, "app.status", map[string]any{"store": id}, "not_found")
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); refs["draft"] == nil {
		t.Fatalf("the app lost its draft: %v", refs)
	}
	// A migration changed after the instance applied it: it stays broken
	// until a reset, and the fresh one runs draft.
	act("instance", map[string]any{"app": "jot", "kind": "dev"})
	app["sql/001.sql"] = "CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT);"
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	if st := h.call(admin, "app.status", map[string]any{"store": id}).(map[string]any); !strings.Contains(st["broken"].(string), "changed after it was applied") {
		t.Fatalf("a changed migration: %v", st)
	}
	act("reset", map[string]any{"app": "jot", "kind": "dev"})
	if d := act("instance", map[string]any{"app": "jot", "kind": "dev"}); d["broken"] != "" || num(d["n"]) != h.refAt(admin, "jot", "draft") {
		t.Fatalf("the fresh dev instance = %v", d)
	}
}

// Proposals: a ref at draft's snapshot that commits go to; the visitor's
// prop and test instances can run it; closing removes the ref (only from
// where the page saw it) and moves those instances off it.
func TestBenchProposals(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(devApp()), "ref": "draft"})
	draft := h.refAt(admin, "jot", "draft")
	p := act("propose", map[string]any{"app": "jot", "title": "Bigger buttons", "thread": "th1"})
	ref := p["ref"].(string)
	if !strings.HasPrefix(ref, "proposal/") || num(p["base"]) != draft || h.refAt(admin, "jot", ref) != draft {
		t.Fatalf("propose = %v", p)
	}
	c := act("commit", map[string]any{"app": "jot", "ref": ref, "base": draft, "changes": []any{map[string]any{"path": "README.md", "text": "proposed"}}})
	if h.refAt(admin, "jot", ref) != num(c["n"]) || h.refAt(admin, "jot", "draft") != draft {
		t.Fatalf("a proposal commit moved draft: %v", c)
	}
	prop := act("instance", map[string]any{"app": "jot", "kind": "prop", "ref": ref})
	test := act("instance", map[string]any{"app": "jot", "kind": "test", "ref": ref})
	if prop["ref"] != ref || test["ref"] != ref || num(prop["n"]) != num(c["n"]) {
		t.Fatalf("prop %v, test %v", prop, test)
	}
	// A second proposal has a prop instance of its own, so two proposals
	// shown side by side each show their own: its commits activate it alone,
	// and each embed runs its proposal's snapshot.
	p2 := act("propose", map[string]any{"app": "jot", "title": "Smaller buttons"})
	ref2 := p2["ref"].(string)
	prop2 := act("instance", map[string]any{"app": "jot", "kind": "prop", "ref": ref2})
	c2 := act("commit", map[string]any{"app": "jot", "ref": ref2, "base": draft, "changes": []any{map[string]any{"path": "README.md", "text": "the other"}}})
	if a := fmtJSON(c2["activated"]); prop2["id"] == prop["id"] || !strings.Contains(a, `"store":"`+prop2["id"].(string)+`"`) || strings.Contains(a, prop["id"].(string)) {
		t.Fatalf("a second proposal's instance %v (the first's %v), activated %v", prop2, prop, a)
	}
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/bench", "store": "bench"})
	page, v := personView(t, h, "admin@example.com", "/bench")
	embed := func(ref string) map[string]any {
		return result(t, rpc(page, v, "slop.call", map[string]any{"action": "embed", "args": map[string]any{"app": "jot", "kind": "prop", "ref": ref}}))
	}
	if e1, e2 := embed(ref), embed(ref2); num(e1["version"]) != num(c["n"]) || num(e2["version"]) != num(c2["n"]) {
		t.Fatalf("the embeds run %v and %v, not %d and %d", e1["version"], e2["version"], num(c["n"]), num(c2["n"]))
	}
	if props := act("status", map[string]any{"app": "jot"})["props"].([]any); len(props) != 2 || props[0].(map[string]any)["ref"] != ref || props[1].(map[string]any)["ref"] != ref2 {
		t.Fatalf("status props = %v", props)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "embed", "args": map[string]any{"app": "jot", "kind": "prop", "ref": "draft"}}, "invalid_argument")
	list := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "proposals", "args": map[string]any{"app": "jot"}}).([]any)
	var first map[string]any
	for _, x := range list {
		if x.(map[string]any)["ref"] == ref {
			first = x.(map[string]any)
		}
	}
	if len(list) != 2 || first == nil || first["status"] != "open" || num(first["n"]) != num(c["n"]) {
		t.Fatalf("proposals = %v", list)
	}
	// Closing from a stale position is refused; from the right one, the ref
	// goes, the prop instance with it, and the test instance follows draft.
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "closeProposal", "args": map[string]any{"app": "jot", "ref": ref, "status": "accepted", "ifAt": draft}}, "conflict")
	act("closeProposal", map[string]any{"app": "jot", "ref": ref, "status": "rejected", "ifAt": num(c["n"])})
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); refs[ref] != nil {
		t.Fatalf("the proposal ref is still there: %v", refs)
	}
	h.fail(admin, "app.status", map[string]any{"store": prop["id"]}, "not_found")
	if st := h.call(admin, "app.status", map[string]any{"store": test["id"], "peek": true}).(map[string]any); st["ref"] != "draft" {
		t.Fatalf("the test instance follows %v", st["ref"])
	}
	if st := h.call(admin, "app.status", map[string]any{"store": prop2["id"], "peek": true}).(map[string]any); st["ref"] != ref2 {
		t.Fatalf("the other proposal's instance follows %v", st["ref"])
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "closeProposal", "args": map[string]any{"app": "jot", "ref": ref, "status": "rejected", "ifAt": 0}}, "conflict")
	evs := act("project", map[string]any{"app": "jot"})["events"].([]any)
	if last := evs[len(evs)-1].(map[string]any); last["kind"] != "reject" || last["ref"] != ref {
		t.Fatalf("the last event = %v", last)
	}
	// An agent's proposal that ended empty is discarded: the ref goes, the
	// timeline does not mention it.
	e := act("propose", map[string]any{"app": "jot", "title": "Nothing came of it"})
	act("closeProposal", map[string]any{"app": "jot", "ref": e["ref"], "status": "discarded", "ifAt": draft})
	if after := act("project", map[string]any{"app": "jot"})["events"].([]any); len(after) != len(evs) {
		t.Fatalf("discarding logged %v", after[len(evs):])
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "closeProposal", "args": map[string]any{"app": "jot", "ref": ref, "status": "closed", "ifAt": 0}}, "invalid_argument")
}

// An instance's data: seeding it (documents named by id, table rows),
// reading it; the app store and other instances are untouched.
func TestBenchInstanceData(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args})
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(devApp()), "ref": "draft"})
	test := act("instance", map[string]any{"app": "jot", "kind": "test"}).(map[string]any)["id"].(string)
	act("seed", map[string]any{"app": "jot", "kind": "test",
		"docs":   map[string]any{"pins": []any{map[string]any{"id": "a", "title": "First"}, map[string]any{"id": "b", "title": "Second"}}},
		"tables": map[string]any{"notes": []any{map[string]any{"id": "n1"}, map[string]any{"id": "n2"}}}})
	if docs := act("docs", map[string]any{"app": "jot", "kind": "test", "coll": "pins"}).([]any); len(docs) != 2 {
		t.Fatalf("docs = %v", docs)
	}
	if d := act("doc", map[string]any{"app": "jot", "kind": "test", "path": "pins/b"}).(map[string]any); !strings.Contains(fmtJSON(d), "Second") {
		t.Fatalf("doc = %v", d)
	}
	if rows := act("sql", map[string]any{"app": "jot", "kind": "test", "query": "SELECT count(*) AS n FROM notes"}); !strings.Contains(fmtJSON(rows), `"n":2`) {
		t.Fatalf("sql = %v", rows)
	}
	if docs := h.call(admin, "docs.ls", map[string]any{"store": "jot", "coll": "pins"}).([]any); len(docs) != 0 {
		t.Fatalf("the app store got the seeded documents: %v", docs)
	}
	if docs := h.call(admin, "docs.ls", map[string]any{"store": test, "coll": "pins"}).([]any); len(docs) != 2 {
		t.Fatalf("the test instance has %v", docs)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "sql", "args": map[string]any{"app": "jot", "kind": "test", "query": "DELETE FROM notes"}}, "invalid_argument") // read-only
}

// The person's records: the project's meta, threads with their messages
// (saved again from where they changed), events from the page, layout
// snapshots; forget drops them all.
func TestBenchRecords(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args})
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	act("saveProject", map[string]any{"app": "jot", "meta": map[string]any{"boards": []any{map[string]any{"id": "b1"}}}})
	act("saveThread", map[string]any{"id": "th1", "app": "jot", "meta": map[string]any{"title": "First"},
		"from": 1, "messages": []any{map[string]any{"role": "user", "text": "hi"}, map[string]any{"role": "agent", "text": "draft"}}})
	act("saveThread", map[string]any{"id": "th1", "app": "jot", "meta": map[string]any{"title": "First"},
		"from": 2, "messages": []any{map[string]any{"role": "agent", "text": "final"}, map[string]any{"role": "user", "text": "thanks"}}})
	th := act("thread", map[string]any{"id": "th1"}).(map[string]any)
	if fmtJSON(th["messages"]) != `[{"role":"user","text":"hi"},{"role":"agent","text":"final"},{"role":"user","text":"thanks"}]` || th["meta"].(map[string]any)["title"] != "First" {
		t.Fatalf("thread = %v", th)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "saveThread", "args": map[string]any{"id": "th1", "app": "other"}}, "invalid_argument")
	logged := act("logEvents", map[string]any{"app": "jot", "events": []any{map[string]any{"kind": "msg", "ref": "draft", "n": 1, "thread": "th1", "note": "hi"}, map[string]any{"kind": "mark", "ref": "draft", "n": 1, "label": "M"}}}).([]any)
	if len(logged) != 2 || num(logged[1].(map[string]any)["seq"]) != 2 || logged[1].(map[string]any)["label"] != "M" || logged[1].(map[string]any)["ref"] != "draft" || num(logged[1].(map[string]any)["n"]) != 1 {
		t.Fatalf("logEvents = %v", logged)
	}
	logBad := func(events ...any) {
		t.Helper()
		h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "logEvents", "args": map[string]any{"app": "jot", "events": events}}, "invalid_argument")
	}
	logBad(map[string]any{"kind": "commit", "ref": "draft", "n": 1})
	// Every event is on a ref with that ref's snapshot; 0 and null are not one.
	logBad(map[string]any{"kind": "mark", "label": "no snapshot"})
	logBad(map[string]any{"kind": "mark", "ref": "draft", "n": 0})
	logBad(map[string]any{"kind": "mark", "n": 3})
	// A batch with one bad event writes none of it.
	logBad(map[string]any{"kind": "mark", "ref": "draft", "n": 2, "label": "fine"}, map[string]any{"kind": "mark", "ref": "draft"})
	// Two tabs seeing the same outside change log it once: the second is
	// answered with the event already there.
	outside := map[string]any{"kind": "outside", "who": "push", "ref": "draft", "n": 7, "paths": []any{"a.txt"}}
	first := act("logEvents", map[string]any{"app": "jot", "events": []any{outside}}).([]any)
	again := act("logEvents", map[string]any{"app": "jot", "events": []any{outside}}).([]any)
	if num(first[0].(map[string]any)["seq"]) != 3 || num(again[0].(map[string]any)["seq"]) != 3 {
		t.Fatalf("outside twice = %v, %v", first, again)
	}
	if older := act("events", map[string]any{"app": "jot", "before": 2}).([]any); len(older) != 1 || older[0].(map[string]any)["kind"] != "msg" {
		t.Fatalf("events before 2 = %v", older)
	}
	act("saveSnap", map[string]any{"id": "sn1", "app": "jot", "meta": map[string]any{"route": "index.html", "w": 375}, "doc": map[string]any{"html": "<p>x</p>"}})
	if list := act("snaps", map[string]any{"app": "jot"}).([]any); len(list) != 1 || list[0].(map[string]any)["route"] != "index.html" {
		t.Fatalf("snaps = %v", list)
	}
	if s := act("snap", map[string]any{"id": "sn1"}).(map[string]any); s["doc"].(map[string]any)["html"] != "<p>x</p>" {
		t.Fatalf("snap = %v", s)
	}
	p := act("project", map[string]any{"app": "jot"}).(map[string]any)
	if p["meta"] == nil || len(p["threads"].([]any)) != 1 || num(p["threads"].([]any)[0].(map[string]any)["count"]) != 3 || len(p["events"].([]any)) != 3 {
		t.Fatalf("project = %v", p)
	}
	act("forget", map[string]any{"app": "jot"})
	if p := act("project", map[string]any{"app": "jot"}).(map[string]any); p["meta"] != nil || len(p["threads"].([]any)) != 0 || len(p["events"].([]any)) != 0 {
		t.Fatalf("after forget = %v", p)
	}
}

// Phase 5: the bench's preflight says what publishing would do and what
// blocks it; publish moves main only from where the preflight saw it;
// activate brings a production instance up now; publishing the previous
// snapshot rolls back.
func TestBenchPublish(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	strs := func(v any) string { return fmtJSON(v) }
	app := devApp()
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})

	// The first publish: everything is new, nothing serves main yet.
	pf := act("preflight", map[string]any{"app": "jot"})
	d1 := num(pf["refs"].(map[string]any)["draft"])
	if pf["refs"].(map[string]any)["main"] != nil || len(pf["added"].([]any)) != len(app) || strs(pf["migrations"]) != `["sql/001.sql"]` || len(pf["blockers"].([]any)) != 0 || len(pf["production"].([]any)) != 0 {
		t.Fatalf("first preflight = %v", pf)
	}
	if r := act("publish", map[string]any{"app": "jot", "n": d1, "ifAt": 0}); num(r["from"]) != 0 {
		t.Fatalf("first publish = %v", r)
	}
	h.call(admin, "store.new", map[string]any{"id": "jot-1", "app": "jot", "type": "jot"})
	h.call(admin, "app.status", map[string]any{"store": "jot-1"}) // runs main, applies 001

	// A changed migration blocks.
	bad := devApp()
	bad["sql/001.sql"] = "CREATE TABLE notes (id TEXT PRIMARY KEY, extra TEXT);"
	h.push(admin, map[string]any{"store": "jot", "files": files(bad), "ref": "draft"})
	if pf = act("preflight", map[string]any{"app": "jot"}); !strings.Contains(strs(pf["blockers"]), "sql/001.sql changed") {
		t.Fatalf("a changed migration: %v", pf)
	}

	// A new migration is listed; a stale ifAt is refused; then publish,
	// activate and roll back.
	good := devApp()
	good["sql/002.sql"] = "CREATE TABLE tags (note TEXT);"
	h.push(admin, map[string]any{"store": "jot", "files": files(good), "ref": "draft"})
	pf = act("preflight", map[string]any{"app": "jot"})
	d2 := num(pf["refs"].(map[string]any)["draft"])
	if strs(pf["migrations"]) != `["sql/002.sql"]` || len(pf["blockers"].([]any)) != 0 || !strings.Contains(strs(pf["production"]), `"jot-1"`) {
		t.Fatalf("second preflight = %v", pf)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": "publish", "args": map[string]any{"app": "jot", "n": d2, "ifAt": 0}}, "conflict")
	act("publish", map[string]any{"app": "jot", "n": d2, "ifAt": d1})
	// The rollout dialog's preflight only looks: jot-1 still runs d1, and
	// d2 waits for its next use; activate brings it up.
	pf = act("preflight", map[string]any{"app": "jot"})
	if !strings.Contains(strs(pf["production"]), fmt.Sprintf(`{"broken":"","n":%d,"next":%d,"store":"jot-1"}`, d1, d2)) {
		t.Fatalf("after the publish, production = %v", pf["production"])
	}
	if a := act("activate", map[string]any{"store": "jot-1"}); num(a["n"]) != d2 || a["broken"] != "" {
		t.Fatalf("activate = %v", a)
	}
	act("publish", map[string]any{"app": "jot", "n": d1, "ifAt": d2}) // roll back
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); num(refs["main"]) != d1 {
		t.Fatalf("after the rollback, main = %v", refs)
	}

	// main no longer has sql/002.sql, but jot-1 ran it: a draft with another
	// 002 is blocked, though main alone would call it new.
	other := devApp()
	other["sql/002.sql"] = "CREATE TABLE labels (note TEXT);"
	h.push(admin, map[string]any{"store": "jot", "files": files(other), "ref": "draft"})
	if pf = act("preflight", map[string]any{"app": "jot"}); !strings.Contains(strs(pf["blockers"]), "sql/002.sql differs from the one that ran on") || !strings.Contains(strs(pf["blockers"]), "jot-1") || strs(pf["migrations"]) != `["sql/002.sql"]` {
		t.Fatalf("a migration that ran before the rollback: %v", pf)
	}
	// The same 002 again is fine: jot-1 has it already.
	h.push(admin, map[string]any{"store": "jot", "files": files(good), "ref": "draft"})
	if pf = act("preflight", map[string]any{"app": "jot"}); len(pf["blockers"].([]any)) != 0 {
		t.Fatalf("the migration that ran, unchanged: %v", pf["blockers"])
	}
	if st := h.call(admin, "app.status", map[string]any{"store": "jot-1", "peek": true, "migrations": true}).(map[string]any); !strings.Contains(fmtJSON(st["applied"]), `"sql/002.sql"`) {
		t.Fatalf("app.status migrations = %v", st)
	}
}

// The bench's actions declare their arguments (SLOP3-024 phase 2): a wrong
// shape is refused before run, naming the place, and the schemas give the
// bench a valid actions.d.ts.
func TestBenchArgs(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	for _, c := range []struct {
		action string
		args   map[string]any
		want   string
	}{
		{"files", map[string]any{"app": "jot", "at": "3"}, "files: at /at: got string, want integer"},
		{"files", map[string]any{"app": "Not An Id", "at": 1}, "at /app: 'Not An Id' does not match pattern"},
		{"head", map[string]any{"app": "jot", "ref": "main"}, "at /ref:"},
		{"commit", map[string]any{"app": "jot", "ref": "draft", "base": 1, "changes": []any{}}, "at /changes: minItems"},
		{"commit", map[string]any{"app": "jot", "ref": "draft", "base": 1, "changes": []any{map[string]any{"text": "no path"}}}, "at /changes/0: missing property 'path'"},
		{"embed", map[string]any{"app": "jot", "kind": "staging"}, "at /kind:"},
		{"closeProposal", map[string]any{"app": "jot", "ref": "proposal/x", "status": "merged", "ifAt": 1}, "at /status:"},
		{"logEvents", map[string]any{"app": "jot", "events": []any{map[string]any{"kind": "note", "ref": "draft", "n": 0}}}, "at /events/0/n: minimum"},
	} {
		e := h.fail(admin, "actor.call", map[string]any{"store": "bench", "action": c.action, "args": c.args}, "invalid_argument")
		if msg, _ := e["message"].(string); !strings.Contains(msg, c.want) {
			t.Errorf("%s(%v): %q, want %q", c.action, c.args, msg, c.want)
		}
	}

	// The page's checker gets the same declarations through the bench's
	// types action (workshop.types → app.types).
	tr := h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "types", "args": map[string]any{"app": "bench"}}).(map[string]any)
	if fs, _ := tr["files"].([]any); len(fs) != 4 || !strings.Contains(fmtJSON(fs), "interface AppActions") {
		t.Fatalf("types = %.300s", fmtJSON(tr))
	}
	decl := appTypes(h, admin, "bench")
	actions := decl[client.TypesDir+"/actions.d.ts"]
	for _, want := range []string{
		"  files(args: {\n    /** a store id: lowercase letters, digits and - */\n    app: string;\n    at: number;\n",
		"    kind: \"dev\" | \"test\" | \"prop\";\n",
		"    status: \"accepted\" | \"rejected\" | \"discarded\";\n",
		"  apps(args?: Record<string, unknown>): unknown;",
	} {
		if !strings.Contains(actions, want) {
			t.Fatalf("the bench's actions.d.ts lacks %q:\n%s", want, actions)
		}
	}
	tsc := tscPath()
	if tsc == "" {
		t.Skip("no tsc: the bench's actions.d.ts is not type-checked")
	}
	dir := t.TempDir()
	writeTree(t, dir, decl)
	for name, cfg := range client.Tsconfigs("actor.js", false) {
		writeTree(t, dir, map[string]string{name: string(cfg)})
	}
	writeTree(t, dir, map[string]string{"main.ts": `const slop = await claude.use('slop')
if (slop) {
  await slop.actions.files({ app: 'jot', at: 3 })
  await slop.actions.commit({ app: 'jot', ref: 'draft', base: 3, changes: [{ path: 'a', text: 'x' }], event: { who: 'you', thread: null } })
  await slop.actions.instance({ app: 'jot', kind: 'prop', ref: 'proposal/x' })
}
`})
	if out, ok := tscCheck(tsc, dir, "tsconfig.json"); !ok {
		t.Fatalf("tsc on the bench's actions:\n%s", out)
	}
}

// The page's checker checks a proposal against its own instance's actions:
// a proposal whose actor renames an action gets declarations with the new
// name, while draft's keep the old (a persona review found the proposal
// checked against draft's actor, "types ok" over a call to a missing action).
func TestBenchTypesFollowRef(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	app := devApp()
	app["actor.js"] = `defineActor({ actions: { list: { requires: 'view', run() { return []; } } } });`
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	draft := h.refAt(admin, "jot", "draft")
	act("instance", map[string]any{"app": "jot", "kind": "dev"})
	ref := act("propose", map[string]any{"app": "jot", "title": "Board"})["ref"].(string)
	act("commit", map[string]any{"app": "jot", "ref": ref, "base": draft, "changes": []any{map[string]any{"path": "actor.js",
		"text": `defineActor({ actions: { board: { requires: 'view', run() { return []; } } } });`}}})
	act("instance", map[string]any{"app": "jot", "kind": "prop", "ref": ref})

	actionsOf := func(args map[string]any) string {
		t.Helper()
		for _, f := range act("types", args)["files"].([]any) {
			if m := f.(map[string]any); m["path"] == "actions.d.ts" {
				return m["text"].(string)
			}
		}
		t.Fatalf("types(%v) has no actions.d.ts", args)
		return ""
	}
	if a := actionsOf(map[string]any{"app": "jot"}); !strings.Contains(a, "  list(") || strings.Contains(a, "board(") {
		t.Fatalf("draft's actions.d.ts:\n%s", a)
	}
	if a := actionsOf(map[string]any{"app": "jot", "ref": ref}); !strings.Contains(a, "  board(") || strings.Contains(a, "list(") {
		t.Fatalf("the proposal's actions.d.ts:\n%s", a)
	}
	// a proposal without an instance yet falls back to the dev instance
	other := act("propose", map[string]any{"app": "jot", "title": "Other"})["ref"].(string)
	if a := actionsOf(map[string]any{"app": "jot", "ref": other}); !strings.Contains(a, "  list(") {
		t.Fatalf("a proposal without an instance:\n%s", a)
	}
}

// Resetting an instance deletes its store; the next use makes it again
// under the same id. Its actor must start over on the new store: the old
// one held the deleted store's closed connection, and every SQL call
// failed with "sql: connection is already closed" (a persona review found
// it: a scenario could run once).
func TestBenchResetRestartsTheActor(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) map[string]any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args}).(map[string]any)
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(devApp()), "ref": "draft"})
	id := act("instance", map[string]any{"app": "jot", "kind": "test"})["id"].(string)
	tables := func() string {
		t.Helper()
		return fmtJSON(h.call(admin, "actor.call", map[string]any{"store": id, "action": "tables"}))
	}
	if got := tables(); !strings.Contains(got, "notes") {
		t.Fatalf("tables before the reset = %s", got)
	}
	act("reset", map[string]any{"app": "jot", "kind": "test"})
	act("instance", map[string]any{"app": "jot", "kind": "test"})
	if got := tables(); !strings.Contains(got, "notes") {
		t.Fatalf("tables after the reset = %s", got)
	}
}

// After a publish the person asks for their link: the bench's addresses
// action lists the mounts serving the app (none until one is set).
func TestBenchAddresses(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(devApp())})
	addr := func() string {
		t.Helper()
		return fmtJSON(h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "addresses", "args": map[string]any{"app": "jot"}}))
	}
	if got := addr(); got != `{"urls":[]}` {
		t.Fatalf("addresses before a mount = %s", got)
	}
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/jot", "store": "jot"})
	if got := addr(); !strings.Contains(got, `"kind":"live"`) || !strings.Contains(got, "/jot\"") {
		t.Fatalf("addresses after a mount = %s", got)
	}
}

// Only admins change app code (D9): the bench's me action tells the page
// before a member tries to create an app.
func TestBenchMe(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	if got := fmtJSON(h.call(admin, "actor.call", map[string]any{"store": "bench", "action": "me", "args": map[string]any{}})); got != `{"audience":"admin","canBuild":true}` {
		t.Fatalf("me as admin = %s", got)
	}
}

// A person removes one row of their dev data (exec, under drop's rule);
// the app's own store is refused.
func TestBenchExec(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	installBench(t, h, admin)
	act := func(action string, args map[string]any) any {
		t.Helper()
		return h.call(admin, "actor.call", map[string]any{"store": "bench", "action": action, "args": args})
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	h.push(admin, map[string]any{"store": "jot", "files": files(devApp()), "ref": "draft"})
	act("instance", map[string]any{"app": "jot", "kind": "dev"})
	act("seed", map[string]any{"app": "jot", "kind": "dev", "tables": map[string]any{"notes": []any{map[string]any{"id": "a"}, map[string]any{"id": "b"}}}})
	act("exec", map[string]any{"app": "jot", "kind": "dev", "query": "DELETE FROM notes WHERE id = ?", "args": []any{"a"}})
	if got := fmtJSON(act("sql", map[string]any{"app": "jot", "kind": "dev", "query": "SELECT id FROM notes", "args": []any{}})); got != `[{"id":"b"}]` {
		t.Fatalf("dev notes after the delete = %s", got)
	}
	// (the app store and production instances are refused: TestWorkshopDevInstances)
}
