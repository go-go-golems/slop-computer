package host

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/client"
)

// SLOP3-022: the server side of the bench's dev loop (draft, dev instances,
// publish). The design is ticket SLOP3-022's guide, Part 5 and Appendix C.

// A minimal app with an actor and one migration; draft adds a second one.
func devApp() map[string]string {
	return map[string]string{
		"app.json":    `{"title":"Jot","actor":"actor.js","type":"jot"}`,
		"actor.js":    `defineActor({ actions: { tables(ctx) { return use('sql').all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name").map(r => r.name); } } });`,
		"sql/001.sql": `CREATE TABLE notes (id TEXT PRIMARY KEY);`,
		"index.html":  "<!doctype html><title>jot</title><main>\n<p>hello</p></main><script src=\"app.js\"></script>",
		"app.js":      "console.log('jot');",
	}
}

// C.3: ref.move with ifAt is a compare-and-swap, so a publish cannot
// silently overwrite another one; the result says where the ref was.
// SLOP3-023: ifAt is required, and ref names are checked.
func TestRefMoveIfAt(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	n1 := num(h.push(admin, map[string]any{"store": "jot", "files": files(app)}).(map[string]any)["n"])
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	n2 := num(h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"}).(map[string]any)["n"])

	// Publish draft: main is still at n1.
	out := h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n2, "ifAt": n1}).(map[string]any)
	if num(out["n"]) != n2 || num(out["from"]) != n1 {
		t.Fatalf("publish = %v, want n %d from %d", out, n2, n1)
	}
	// A second publisher who still believes main is at n1 is refused.
	e := h.fail(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n1, "ifAt": n1}, "conflict")
	if at := num(e["extra"].(map[string]any)["at"]); at != n2 {
		t.Fatalf("conflict extra.at = %d, want %d", at, n2)
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); num(refs["main"]) != n2 {
		t.Fatalf("main moved by a refused publish: %v", refs)
	}
	// ifAt 0: only if the ref does not exist yet.
	h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "release", "n": n1, "ifAt": 0})
	h.fail(admin, "ref.move", map[string]any{"store": "jot", "ref": "release", "n": n2, "ifAt": 0}, "conflict")
	// Without ifAt nothing moves; a rollback states where main is.
	h.fail(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n1}, "invalid_argument")
	out = h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "main", "n": n1, "ifAt": n2}).(map[string]any)
	if num(out["from"]) != n2 {
		t.Fatalf("rollback from = %v, want %d", out["from"], n2)
	}
	// Ref names: lowercase, starting with a letter, /-separated segments.
	for _, bad := range []string{"42", "Draft", "draft/", "/x", "a//b", "a b", "a/b/c/d/e/f", ""} {
		h.fail(admin, "ref.move", map[string]any{"store": "jot", "ref": bad, "n": n1, "ifAt": 0}, "invalid_argument")
	}
	h.call(admin, "ref.move", map[string]any{"store": "jot", "ref": "proposal/p8k2x1", "n": n1, "ifAt": 0})
}

func num(v any) int64 {
	switch x := v.(type) {
	case float64:
		return int64(x)
	case int64:
		return x
	case int:
		return int64(x)
	}
	return -1
}

// C.2: files.push {activate} brings the listed stores up on the new
// snapshot and reports each, so a dev loop learns at once that a
// migration failed, while the instance keeps serving its last good version.
func TestPushActivates(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	h.push(admin, map[string]any{"store": "jot", "files": files(app)})
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	h.call(admin, "store.new", map[string]any{"id": "jot-dev", "app": "jot", "type": "jot"})
	h.call(admin, "app.follow", map[string]any{"store": "jot-dev", "ref": "draft"})

	activated := func(out any) map[string]any {
		t.Helper()
		l, _ := out.(map[string]any)["activated"].([]any)
		if len(l) != 2 {
			t.Fatalf("activated = %v, want 2 entries", out)
		}
		if e, _ := l[1].(map[string]any)["error"].(string); e == "" {
			t.Fatalf("an unknown store reports no error: %v", l[1])
		}
		return l[0].(map[string]any)
	}

	// A good migration: the dev instance is on the new snapshot.
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	out := h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft", "activate": []string{"jot-dev", "nope"}})
	n := num(out.(map[string]any)["n"])
	a := activated(out)
	if a["store"] != "jot-dev" || a["ref"] != "draft" || num(a["n"]) != n || a["broken"] != "" {
		t.Fatalf("activated[0] = %v, want jot-dev on draft at %d, not broken", a, n)
	}
	if got := fmtAny(h.call(admin, "actor.call", map[string]any{"store": "jot-dev", "action": "tables"})); got != `["notes","tags"]` {
		t.Fatalf("dev tables = %s", got)
	}

	// A broken migration: reported, and the instance keeps the good version.
	app["sql/003_bad.sql"] = `CREATE TABL oops (x);`
	out = h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft", "activate": []string{"jot-dev", "nope"}})
	a = activated(out)
	if b, _ := a["broken"].(string); !strings.Contains(b, "003_bad") {
		t.Fatalf("broken = %q, want the failing migration named", a["broken"])
	}
	if num(a["n"]) != n {
		t.Fatalf("n = %v, want the last good snapshot %d", a["n"], n)
	}
	if got := fmtAny(h.call(admin, "actor.call", map[string]any{"store": "jot-dev", "action": "tables"})); got != `["notes","tags"]` {
		t.Fatalf("dev tables after a failed migration = %s", got)
	}
}

const devBenchActor = `
const ws = use('workshop');
defineActor({
  actions: {
    async instance(ctx, { app, id, ref }) { await ws.newStore(id, { app, type: 'jot' }); return await ws.follow(id, ref); },
    async seed(ctx, { id }) {
      await ws.importTable(id, 'notes', [{ id: 'a' }, { id: 'b' }]);
      await ws.importDocs(id, 'settings', [{ id: 'shop', open: '07:00' }], { id: 'id' });
      return { rows: await ws.sql(id, 'SELECT count(*) AS n FROM notes'), doc: await ws.doc(id, 'settings/shop'), docs: await ws.docs(id, 'settings') };
    },
    async push(ctx, { app, files, activate, ifAt }) { return await ws.push(app, files, { activate, ifAt }); },
    async publish(ctx, { app, n, ifAt }) { return await ws.publish(app, n, { ifAt }); },
    async logs(ctx, { id }) { return await ws.logs(id); },
    async drop(ctx, { id }) { return await ws.drop(id); },
  },
});
`

// C.4: the workshop module runs a dev loop as the visitor: an instance on
// draft, seeded from a fixture, pushed with activation, published with a
// compare-and-swap, and dropped; drop refuses app stores and instances on
// main, which an admin could otherwise delete by mistake.
func TestWorkshopDevInstances(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	toolApp(t, h, admin, "devbench", devBenchActor, "workshop")
	h.call(admin, "app.trust", map[string]any{"app": "devbench", "module": "workshop"})
	call := func(action string, args map[string]any) any {
		return h.call(admin, "actor.call", map[string]any{"store": "devbench", "action": action, "args": args})
	}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	main := num(h.push(admin, map[string]any{"store": "jot", "files": files(app)}).(map[string]any)["n"])
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})

	// A dev instance on draft, seeded from a fixture.
	if f := call("instance", map[string]any{"app": "jot", "id": "jot-dev-a1", "ref": "draft"}).(map[string]any); f["ref"] != "draft" || f["broken"] != "" {
		t.Fatalf("instance = %v", f)
	}
	seeded := fmtAny(call("seed", map[string]any{"id": "jot-dev-a1"}))
	if !strings.Contains(seeded, `"n":2`) || !strings.Contains(seeded, `"open":"07:00"`) {
		t.Fatalf("seed = %s", seeded)
	}

	// A push through the module reports the instance's activation.
	app["sql/002_tags.sql"] = `CREATE TABLE tags (note TEXT, tag TEXT);`
	out := call("push", map[string]any{"app": "jot", "files": files(app), "activate": []string{"jot-dev-a1"}, "ifAt": h.refAt(admin, "jot", "draft")}).(map[string]any)
	draft := num(out["n"])
	if a := fmtAny(out["activated"]); !strings.Contains(a, `"broken":""`) || !strings.Contains(a, `"ref":"draft"`) {
		t.Fatalf("activated = %s", a)
	}

	// Publish with a stale ifAt is refused; with the right one it moves main.
	h.fail(admin, "actor.call", map[string]any{"store": "devbench", "action": "publish", "args": map[string]any{"app": "jot", "n": draft, "ifAt": main + 100}}, "conflict")
	if p := call("publish", map[string]any{"app": "jot", "n": draft, "ifAt": main}).(map[string]any); num(p["from"]) != main {
		t.Fatalf("publish = %v", p)
	}

	// drop: a dev instance yes; a production instance and the app store no.
	call("drop", map[string]any{"id": "jot-dev-a1"})
	h.fail(admin, "app.status", map[string]any{"store": "jot-dev-a1"}, "not_found")
	h.call(admin, "store.new", map[string]any{"id": "jot-shop", "app": "jot", "type": "jot"})
	h.fail(admin, "actor.call", map[string]any{"store": "devbench", "action": "drop", "args": map[string]any{"id": "jot-shop"}}, "permission_denied")
	h.fail(admin, "actor.call", map[string]any{"store": "devbench", "action": "drop", "args": map[string]any{"id": "jot"}}, "permission_denied")
	h.call(admin, "app.status", map[string]any{"store": "jot-shop"})
}

const embedBenchActor = `
const ws = use('workshop');
defineActor({
  actions: {
    embed: { requires: 'view', async run(ctx, { store, dev }) { return await ws.embed(store, { dev }); } },
    renew: { requires: 'view', async run(ctx, { view }) { return await ws.renewEmbed(view); } },
  },
});
`

// personView signs email in on the live host and opens the page mounted
// at path, as a browser does.
func personView(t *testing.T, h *harness, email, path string) (*site, map[string]any) {
	t.Helper()
	live := h.cfg.Hosts.Live[0]
	b := h.browser()
	b.signIn(email)
	s := h.site(live)
	signInSite(t, h, s, b, live, path)
	return s, guestView(t, s, path)
}

// C.1: a tool trusted with workshop opens a view of a store for the
// person on its page, framed by its own page: the sandbox lets the tool's
// origin frame it and names the tool as the runtime's parent; a dev embed
// (admin only) adds data-src lines and the probe; tokens are bound to
// their origin; a renew is for the person and the tool that opened the
// view. A caller with a token gets neither: the view would shed its scopes.
func TestEmbeddedViews(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	toolApp(t, h, admin, "devbench", embedBenchActor, "workshop")
	h.call(admin, "app.trust", map[string]any{"app": "devbench", "module": "workshop"})
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": "/devbench", "store": "devbench"})
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	app := devApp()
	app["about.html"] = "<!doctype html>\n<p>about</p>\n" // another page
	app["part.html"] = "<li>a fragment</li>\n"            // HTML the app fetches and inserts
	h.push(admin, map[string]any{"store": "jot", "files": files(app)})
	h.push(admin, map[string]any{"store": "jot", "files": files(app), "ref": "draft"})
	h.call(admin, "store.new", map[string]any{"id": "jot-dev", "app": "jot", "type": "jot"})
	h.call(admin, "app.follow", map[string]any{"store": "jot-dev", "ref": "draft"})
	h.call(admin, "grant.set", map[string]any{"store": "jot-dev", "subject": "@member", "level": "view"})
	adminPage, adminTool := personView(t, h, "admin@example.com", "/devbench")
	bobPage, bobTool := personView(t, h, "bob@example.com", "/devbench")
	call := func(s *site, tool map[string]any, action string, args map[string]any) map[string]any {
		return rpc(s, tool, "slop.call", map[string]any{"action": action, "args": args})
	}
	embed := func(s *site, tool map[string]any, dev bool) map[string]any {
		t.Helper()
		return result(t, call(s, tool, "embed", map[string]any{"store": "jot-dev", "dev": dev}))
	}
	open := func(src string) (string, string, int, string) {
		u, _ := url.Parse(src)
		r, body := h.get(u.Host, u.RequestURI())
		return u.Host, u.Query().Get("parent"), r.StatusCode, r.Header.Get("Content-Security-Policy") + "\n" + body
	}

	// A dev embed, for an admin.
	e := embed(adminPage, adminTool, true)
	host, tool, status, page := open(e["src"].(string))
	if status != 200 || e["dev"] != true || e["secret"] == "" {
		t.Fatalf("dev embed: %d %v", status, e)
	}
	if !strings.HasPrefix(tool, h.cfg.Scheme+"://s") || strings.Contains(tool, host) {
		t.Fatalf("parent %q is not the tool's own sandbox origin (frame on %s)", tool, host)
	}
	for _, want := range []string{"frame-ancestors " + h.cfg.MainURL(), " " + tool + "\n", `"parentOrigin":"` + tool + `"`, "/_slop/probe.js", `<p data-src="index.html:2">hello</p>`} {
		if !strings.Contains(page, want) {
			t.Errorf("dev embed page lacks %q:\n%s", want, page)
		}
	}
	// Its files load under the same address; the token works on its origin only.
	u, _ := url.Parse(e["src"].(string))
	if r, body := h.get(host, strings.TrimSuffix(u.Path, "/")+"/app.js"); r.StatusCode != 200 || !strings.Contains(body, "jot") {
		t.Fatalf("app.js under the embed: %d %q", r.StatusCode, body)
	}
	// Another page of the app is served as the entry is (a bench frame on
	// about.html has the probe); a fragment is served as stored.
	under := func(e map[string]any, p string) string {
		v, _ := url.Parse(e["src"].(string))
		v.Path = strings.TrimSuffix(v.Path, "/") + "/" + p
		return v.String()
	}
	_, _, status, about := open(under(e, "about.html"))
	for _, want := range []string{`"parentOrigin":"` + tool + `"`, "/_slop/claude.js", "/_slop/probe.js", `<p data-src="about.html:2">about</p>`} {
		if status != 200 || !strings.Contains(about, want) {
			t.Errorf("about.html under the dev embed (%d) lacks %q:\n%s", status, want, about)
		}
	}
	if r, body := h.get(host, strings.TrimSuffix(u.Path, "/")+"/part.html"); r.StatusCode != 200 || body != app["part.html"] {
		t.Fatalf("part.html under the embed: %d %q", r.StatusCode, body)
	}
	toolHost := strings.TrimPrefix(tool, h.cfg.Scheme+"://")
	if r, _ := h.get(toolHost, u.RequestURI()); r.StatusCode != 404 {
		t.Fatalf("the token on another origin: %d, want 404", r.StatusCode)
	}
	if r, _ := h.get(host, "/e/emb_nope/v/0/"); r.StatusCode != 404 {
		t.Fatalf("an unknown token: %d, want 404", r.StatusCode)
	}

	// A plain embed, for a viewer: framed by the tool, no probe, no data-src.
	e2 := embed(bobPage, bobTool, false)
	_, tool2, status, page := open(e2["src"].(string))
	if status != 200 || tool2 != tool || strings.Contains(page, "probe.js") || strings.Contains(page, "data-src") || !strings.Contains(page, " "+tool+"\n") {
		t.Fatalf("plain embed: %d %q\n%s", status, tool2, page)
	}
	if _, _, status, about := open(under(e2, "about.html")); status != 200 || !strings.Contains(about, "/_slop/claude.js") || strings.Contains(about, "probe.js") || strings.Contains(about, "data-src") {
		t.Fatalf("about.html under the plain embed: %d\n%s", status, about)
	}
	// A viewer gets no dev embed.
	if out := call(bobPage, bobTool, "embed", map[string]any{"store": "jot-dev", "dev": true}); errCode(out) != "not_granted" {
		t.Fatalf("a viewer's dev embed = %v", out)
	}

	// Renew: for the person and the tool that opened the view.
	r := result(t, call(adminPage, adminTool, "renew", map[string]any{"view": e["view"]}))
	if r["view"] != e["view"] || r["secret"] != e["secret"] {
		t.Fatalf("renew = %v", r)
	}
	if out := call(bobPage, bobTool, "renew", map[string]any{"view": e["view"]}); errCode(out) != "not_found" {
		t.Fatalf("another person's renew = %v", out)
	}

	// A token, even an admin's, opens and renews no embed (Codex on #46).
	h.fail(admin, "actor.call", map[string]any{"store": "devbench", "action": "embed", "args": map[string]any{"store": "jot-dev"}}, "not_granted")
	h.fail(admin, "actor.call", map[string]any{"store": "devbench", "action": "renew", "args": map[string]any{"view": e["view"]}}, "not_granted")
}

// syncBuf is a bytes.Buffer two goroutines may use.
type syncBuf struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *syncBuf) Write(p []byte) (int, error) { s.mu.Lock(); defer s.mu.Unlock(); return s.b.Write(p) }
func (s *syncBuf) String() string              { s.mu.Lock(); defer s.mu.Unlock(); return s.b.String() }

// pushFails fails files.push while it is set, as a server that cannot be
// reached would.
type pushFails struct {
	hostTransport
	on *atomic.Bool
}

func (t pushFails) RoundTrip(r *http.Request) (*http.Response, error) {
	if t.on.Load() && strings.HasSuffix(r.URL.Path, "/files.push") {
		return nil, errors.New("connection refused")
	}
	return t.hostTransport.RoundTrip(r)
}

// C.5: slop dev pushes a folder to draft, makes the person's dev instance
// on first use (with the type its app.json declares, though the app has no
// main yet), and on each change reports where the instance is (or why it
// broke) and its new log lines; a failed push is retried without another
// change; main is never moved.
func TestSlopDev(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	var down atomic.Bool
	c := &client.Client{Server: h.ts.URL, Token: admin, HTTP: &http.Client{Transport: pushFails{hostTransport{h.cfg.Hosts.Main}, &down}}}
	h.call(admin, "store.new", map[string]any{"id": "jot"})
	dir := t.TempDir()
	write := func(path, text string) {
		t.Helper()
		p := filepath.Join(dir, path)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for p, text := range devApp() {
		write(p, text)
	}
	write("actor.js", `defineActor({ setup(ctx) { console.log('setup ran'); }, actions: { ping() { return 'pong'; } } });`)
	who := h.call(admin, "whoami", map[string]any{}).(map[string]any)["id"].(string)
	inst := client.DevInstanceID("jot", who)

	// --once: the instance is made, follows draft and runs it.
	var once syncBuf
	if err := c.Dev(context.Background(), dir, client.DevOptions{App: "jot", Once: true, Out: &once}); err != nil {
		t.Fatal(err)
	}
	if out := once.String(); !strings.Contains(out, "made dev instance "+inst) || !strings.Contains(out, inst+" on ") || !strings.Contains(out, "· ok") {
		t.Fatalf("once:\n%s", out)
	}
	if st := h.call(admin, "app.status", map[string]any{"store": inst}).(map[string]any); st["ref"] != "draft" || st["app"] != "jot" {
		t.Fatalf("instance = %v", st)
	}
	if refs := h.call(admin, "ref.ls", map[string]any{"store": "jot"}).(map[string]any); refs["main"] != nil {
		t.Fatalf("slop dev moved main: %v", refs)
	}
	for _, x := range h.call(admin, "store.ls", map[string]any{"all": true}).([]any) {
		if m := x.(map[string]any); m["id"] == inst && m["type"] != "jot" {
			t.Fatalf("the instance's type is %q, not app.json's", m["type"])
		}
	}

	// The loop: a change is pushed and reported, with the instance's log;
	// a broken migration is reported and the instance stays on its version.
	var out syncBuf
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- c.Dev(ctx, dir, client.DevOptions{App: "jot", Every: 30 * time.Millisecond, Out: &out})
	}()
	wait := func(what string) {
		t.Helper()
		for i := 0; i < 200 && !strings.Contains(out.String(), what); i++ {
			time.Sleep(20 * time.Millisecond)
		}
		if !strings.Contains(out.String(), what) {
			cancel()
			t.Fatalf("waited for %q:\n%s", what, out.String())
		}
	}
	wait("publish with")
	time.Sleep(50 * time.Millisecond) // a new modification time
	write("sql/002_tags.sql", `CREATE TABLE tags (note TEXT, tag TEXT);`)
	wait("log log   setup ran")
	// The server is unreachable for a push: the change stays pending and
	// goes up once it is back, with no further edit.
	down.Store(true)
	write("README.md", "jot")
	wait("push failed, will retry")
	down.Store(false)
	wait(" on 3 · ok")
	write("sql/003_bad.sql", `CREATE TABL oops (x);`)
	wait("broken: ")
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "stays on") || !strings.Contains(out.String(), "003_bad") {
		t.Fatalf("broken push:\n%s", out.String())
	}
	t.Logf("slop dev printed:\n%s%s", once.String(), out.String())
}

// files.push with ifAt snapshots only when the ref is still where the
// pusher saw it, checked in the push's own turn: a stale push writes
// nothing.
func TestPushIfAt(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "site"})
	one := map[string]string{"index.html": "<h1>one</h1>"}
	r := h.push(admin, map[string]any{"store": "site", "files": files(one), "ref": "draft", "ifAt": 0}).(map[string]any)
	n1 := num(r["n"])
	h.fail(admin, "files.push", map[string]any{"store": "site", "files": files(one), "ref": "draft", "ifAt": 0}, "conflict")
	two := map[string]string{"index.html": "<h1>two</h1>"}
	h.push(admin, map[string]any{"store": "site", "files": files(two), "ref": "draft", "ifAt": n1})
	stale := map[string]string{"index.html": "<h1>stale</h1>", "extra.html": "x"}
	h.fail(admin, "files.push", map[string]any{"store": "site", "files": files(stale), "ref": "draft", "ifAt": n1}, "conflict")
	if got := h.call(admin, "files.cat", map[string]any{"store": "site", "at": "draft", "path": "index.html"}); got != "<h1>two</h1>" {
		t.Fatalf("draft index.html = %v", got)
	}
	if out := h.call(admin, "files.ls", map[string]any{"store": "site"}).([]any); len(out) != 1 {
		t.Fatalf("the stale push wrote to the tree: %v", out)
	}
	// ifAt is required; prune, snapshot and zone are gone (always the
	// tree, pruned and snapshotted); a ref name is checked.
	h.fail(admin, "files.push", map[string]any{"store": "site", "files": files(two), "ref": "draft"}, "invalid_argument")
	for _, knob := range []string{"prune", "snapshot", "zone"} {
		h.fail(admin, "files.push", map[string]any{"store": "site", "files": files(two), "ref": "draft", "ifAt": 2, knob: false}, "invalid_argument")
	}
	h.fail(admin, "files.push", map[string]any{"store": "site", "files": files(two), "ref": "Draft", "ifAt": 0}, "invalid_argument")
}
