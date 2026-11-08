package host

// SLOP3-016: Pinboard, a collaborative board per store. The app store
// "pinboard" holds the code; members create boards at /pb/<new id> (each a
// store of type pinboard that runs it); /boards lists a person's boards
// through slop.stores.list. The manifest's rules keep the board's title and
// apps for admins; the actor's actions run the same core as the page.

import (
	"encoding/json"
	"strings"
	"testing"
)

func asJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func TestPinboardApp(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "pinboard"})
	h.call(admin, "files.push", map[string]any{"store": "pinboard", "files": appDir(t, "pinboard")})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/pb/:id", "storeParam": "id", "type": "pinboard", "createApp": "pinboard"})
	h.call(admin, "store.new", map[string]any{"id": "pinboard-home"})
	h.call(admin, "files.push", map[string]any{"store": "pinboard-home", "files": appDir(t, "pinboard-home")})
	h.call(admin, "grant.set", map[string]any{"store": "pinboard-home", "subject": "@member", "level": "view"})
	h.call(admin, "mount.set", map[string]any{"host": live, "path": "/boards", "store": "pinboard-home"})

	signIn := func(email, ret string) *site {
		t.Helper()
		b, s := h.browser(), h.site(live)
		b.signIn(email)
		signInSite(t, h, s, b, live, ret)
		return s
	}
	view := func(s *site, path, level string) map[string]any {
		t.Helper()
		st, v := openView(s, live, path, "")
		if st != 200 || (level != "" && v["level"] != level) {
			t.Fatalf("view %s: %d %v", path, st, v)
		}
		return v
	}
	write := func(s *site, v map[string]any, path string, body map[string]any) map[string]any {
		return rpc(s, v, "db.write", map[string]any{"path": path, "op": "set", "body": body})
	}

	// Ada makes two boards; she owns both.
	sa := signIn("ada@example.com", "/pb/new-1")
	create := func() string {
		t.Helper()
		r, out := sa.do("POST", live, "/_site/create", map[string]any{"path": "/pb/new-1"}, nil)
		if r.StatusCode != 201 || !strings.HasPrefix(out["path"].(string), "/pb/") {
			t.Fatalf("create: %d %v", r.StatusCode, out)
		}
		return out["store"].(string)
	}
	kitchen, work := create(), create()
	va := view(sa, "/pb/"+kitchen, "owner")
	if out := write(sa, va, "board/meta", map[string]any{"title": "Kitchen", "seeded": 1}); out["error"] != nil {
		t.Fatalf("ada titles her board: %v", out)
	}
	if out := write(sa, view(sa, "/pb/"+work, "owner"), "board/meta", map[string]any{"title": "Work notes"}); out["error"] != nil {
		t.Fatalf("ada titles her second board: %v", out)
	}

	// Bob may edit Kitchen, Carol may view it; neither has Work notes.
	bobTok, carolTok := h.tokenFor("bob@example.com", "read", "write"), h.tokenFor("carol@example.com", "read", "write")
	bobID := h.call(bobTok, "whoami", nil).(map[string]any)["id"].(string)
	carolID := h.call(carolTok, "whoami", nil).(map[string]any)["id"].(string)
	h.call(admin, "grant.set", map[string]any{"store": kitchen, "subject": bobID, "level": "interact"})
	h.call(admin, "grant.set", map[string]any{"store": kitchen, "subject": carolID, "level": "view"})
	sb, sc := signIn("bob@example.com", "/pb/"+kitchen), signIn("carol@example.com", "/pb/"+kitchen)
	vb, vc := view(sb, "/pb/"+kitchen, "interact"), view(sc, "/pb/"+kitchen, "view")

	// The rules: clips, records and the log for editors; the title for admins.
	if out := write(sb, vb, "clips/clip:b1", map[string]any{"id": "clip:b1", "kind": "note", "text": "hi"}); out["error"] != nil {
		t.Fatalf("bob adds a clip: %v", out)
	}
	if out := write(sb, vb, "log/tx:b1", map[string]any{"id": "tx:b1", "by": "Bob", "at": 1, "label": "place", "ops": []any{}}); out["error"] != nil {
		t.Fatalf("bob writes the log: %v", out)
	}
	for _, p := range []string{"apps/evil", "apps/evil/versions/1", "board/meta"} {
		if out := write(sb, vb, p, map[string]any{"name": "evil", "source": "x"}); out["error"] == nil {
			t.Fatalf("bob (interact) wrote %s", p)
		}
	}
	if out := write(sc, vc, "clips/clip:c1", map[string]any{"kind": "note"}); out["error"] == nil {
		t.Fatalf("carol (view) wrote a clip")
	}
	// Nobody's page writes apps/, the owner's included: the actor registers
	// apps (registerApp, SLOP3-017; TestPinboardAppRegistration).
	if out := write(sa, va, "apps/greeter", map[string]any{"name": "greeter", "source": "app('greeter').register()", "version": 1}); out["error"] == nil {
		t.Fatalf("ada (owner) wrote apps/greeter from her page")
	}
	// Each person's view, trust and threads are private.
	ada := va["user"].(string)
	if out := write(sa, va, "data/users/"+ada+"/trust", map[string]any{"apps": map[string]any{"x": "abc"}}); out["error"] != nil {
		t.Fatalf("ada's trust: %v", out)
	}
	if d := result(t, rpc(sb, vb, "db.get", map[string]any{"path": "data/users/" + ada + "/trust"})); d["exists"] != false {
		t.Fatalf("bob reads ada's trust: %v", d)
	}

	// The actor: the same core, as the caller.
	call := func(tok, action string, args map[string]any) any {
		return h.call(tok, "actor.call", map[string]any{"store": kitchen, "action": action, "args": args})
	}
	added := call(bobTok, "addClip", map[string]any{"url": "https://example.com/r", "title": "a recipe", "tags": "food,cli", "via": "cli"}).(map[string]any)
	if added["kind"] != "link" || !strings.HasPrefix(added["id"].(string), "clip:") {
		t.Fatalf("addClip: %v", added)
	}
	h.fail(carolTok, "actor.call", map[string]any{"store": kitchen, "action": "addClip", "args": map[string]any{"text": "x"}}, "permission_denied")
	if e := h.fail(carolTok, "actor.call", map[string]any{"store": kitchen, "action": "insert", "args": map[string]any{"coll": "x", "data": map[string]any{"a": 1}}}, "permission_denied"); e == nil {
		t.Fatal("carol inserted")
	}
	call(bobTok, "insert", map[string]any{"coll": "my recipes", "data": map[string]any{"title": "Soup", "minutes": 20}})
	call(bobTok, "insert", map[string]any{"coll": "my recipes", "data": map[string]any{"title": "Cake", "minutes": 60}})
	rows := call(carolTok, "query", map[string]any{"coll": "my recipes", "where": []any{[]any{"minutes", "<", 30}}}).([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["title"] != "Soup" {
		t.Fatalf("query: %v", rows)
	}
	d := call(carolTok, "describe", nil).(map[string]any)
	if d["title"] != "Kitchen" || !strings.Contains(asJSON(d), "a recipe") || !strings.Contains(asJSON(d), "my recipes") {
		t.Fatalf("describe: %v", d)
	}
	tagged := call(carolTok, "clips", map[string]any{"tag": "cli"}).([]any)
	if len(tagged) != 1 {
		t.Fatalf("clips by tag: %v", tagged)
	}
	log := call(carolTok, "log", map[string]any{"limit": 5}).([]any)
	if len(log) != 4 || !strings.Contains(asJSON(log), `"by":"bob (cli)"`) || !strings.Contains(asJSON(log[0]), "insert my recipes") {
		t.Fatalf("log: %v", log)
	}

	// "My boards": the home page lists a person's boards of type pinboard,
	// with titles read as them.
	list := func(s *site) []any {
		t.Helper()
		v := view(s, "/boards", "")
		out := rpc(s, v, "slop.stores", map[string]any{"type": "pinboard", "title": "board/meta"})
		if out["error"] != nil {
			t.Fatalf("slop.stores: %v", out)
		}
		return result(t, out)["stores"].([]any)
	}
	titles := func(rows []any) string {
		s := []string{}
		for _, r := range rows {
			m := r.(map[string]any)
			s = append(s, m["title"].(string)+":"+m["level"].(string)+":"+map[bool]string{true: "mine", false: "shared"}[m["mine"] == true])
		}
		return strings.Join(s, ",")
	}
	if got := titles(list(sa)); got != "Work notes:owner:mine,Kitchen:owner:mine" {
		t.Fatalf("ada's boards: %s", got)
	}
	if got := titles(list(sb)); got != "Kitchen:interact:shared" {
		t.Fatalf("bob's boards: %s", got)
	}
	dave := signIn("dave@example.com", "/boards")
	if got := list(dave); len(got) != 0 {
		t.Fatalf("dave sees boards: %v", got)
	}
	v := view(sa, "/boards", "")
	if out := rpc(sa, v, "slop.stores", map[string]any{}); out["error"] == nil {
		t.Fatal("slop.stores without a type")
	}
}
