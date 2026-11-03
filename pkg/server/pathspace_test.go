package server

// Tests for SLOP3-008 phase 1: one path space per page (aliases into other
// stores, _stores/<id>/…), with their documents, changes and uploads.

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-go-golems/slop-computer/pkg/store"
)

// pageApp pushes a one-page app into storeID whose app.json declares db
// with dbCfg, and mounts it at path on the live host for guests.
func pageApp(h *harness, admin, storeID, path, dbCfg string) {
	h.t.Helper()
	h.call(admin, "store.new", map[string]any{"id": storeID})
	h.call(admin, "files.push", map[string]any{"store": storeID, "files": files(map[string]string{
		"app.json":   `{"title":"` + storeID + `","capabilities":{"db":` + dbCfg + `}}`,
		"index.html": `<!doctype html><html><head><title>p</title></head><body>page</body></html>`,
	})})
	h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": path, "store": storeID})
	h.call(admin, "grant.set", map[string]any{"store": storeID, "subject": "@guest", "level": "interact"})
}

// guestView opens a guest view of the page mounted at path.
func guestView(t *testing.T, s *site, path string) map[string]any {
	t.Helper()
	code, v := openView(s, s.host, path, "")
	if code != 200 {
		t.Fatalf("open %s: %d %v", path, code, v)
	}
	return v
}

func result(t *testing.T, out map[string]any) map[string]any {
	t.Helper()
	r, ok := out["result"].(map[string]any)
	if !ok {
		t.Fatalf("no result: %v", out)
	}
	return r
}

func errCode(out map[string]any) string {
	if e, ok := out["error"].(map[string]any); ok {
		c, _ := e["code"].(string)
		return c
	}
	return ""
}

// An unmodified page reads another store through an alias, as the viewer:
// what the viewer may see there, capped by the alias's level; writes need
// both; its own collections are untouched.
func TestAliasReadsAnotherStore(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	pageApp(h, admin, "dash", "/dash", `{}`)
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})

	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/dash")
	// The guest holds nothing on crm: the alias shows nothing.
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"})); d["exists"] != false {
		t.Fatalf("without a grant on crm: %v", d)
	}
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "interact"})
	d := result(t, rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"}))
	if d["exists"] != true || d["path"] != "contacts/c1" || d["body"].(map[string]any)["name"] != "Ada" {
		t.Fatalf("through the alias: %v", d)
	}
	docs := result(t, rpc(s, v, "db.query", map[string]any{"coll": "contacts"}))["docs"].([]any)
	if len(docs) != 1 || docs[0].(map[string]any)["path"] != "contacts/c1" {
		t.Fatalf("query through the alias: %v", docs)
	}
	// The alias gives view: the guest's interact on crm does not let it write.
	if out := rpc(s, v, "db.write", map[string]any{"path": "contacts/c2", "op": "set", "body": map[string]any{"name": "Bo"}}); errCode(out) != "invalid_argument" {
		t.Fatalf("write through a view alias: %v", out)
	}
	// Its own collections are its own.
	if out := rpc(s, v, "db.write", map[string]any{"path": "notes/n1", "op": "set", "body": map[string]any{"t": "x"}}); out["result"] == nil {
		t.Fatalf("own write: %v", out)
	}
	// Top-level _ names are the platform's; _stores is not open to this app.
	for _, p := range []string{"_x/y", "_stores/crm/contacts/c1"} {
		if out := rpc(s, v, "db.get", map[string]any{"path": p}); errCode(out) != "invalid_argument" {
			t.Fatalf("%s: %v", p, out)
		}
	}

	// An alias at interact: the view reopens with the new path space, and
	// the write lands in crm, as the guest, from dash's app.
	if out := h.fail(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts/c1"}, "invalid_argument"); out == nil {
		t.Fatal("a document prefix was accepted")
	}
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts", "level": "interact"})
	if out := rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"}); errCode(out) != "revoked" {
		t.Fatalf("the old view after its aliases changed: %v", out)
	}
	v = guestView(t, s, "/dash")
	if out := rpc(s, v, "db.write", map[string]any{"path": "contacts/c2", "op": "set", "body": map[string]any{"name": "Bo"}}); out["result"] == nil {
		t.Fatalf("write through an interact alias: %v", out)
	}
	got := h.call(admin, "docs.get", map[string]any{"store": "crm", "path": "contacts/c2"}).(map[string]any)
	if got["body"].(map[string]any)["name"] != "Bo" {
		t.Fatalf("crm contacts/c2 = %v", got)
	}
	log := h.call(admin, "log.show", map[string]any{"store": "crm", "limit": 1}).([]any)
	if e := log[0].(map[string]any); e["via"] != "page" || !strings.HasPrefix(e["principal"].(string), "vis_") || !strings.HasPrefix(e["app"].(string), "dash@") {
		t.Fatalf("crm log = %v", e)
	}
	// Removing the alias closes the views that used it.
	h.call(admin, "bind.rm", map[string]any{"store": "dash", "alias": "contacts"})
	if out := rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"}); errCode(out) != "revoked" {
		t.Fatalf("after bind.rm: %v", out)
	}
	v = guestView(t, s, "/dash")
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"})); d["exists"] != false {
		t.Fatalf("contacts is the page's own again: %v", d)
	}
}

// Whoever sets an alias must hold its level on the target.
func TestAliasNeedsTheLevelOnTheTarget(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(mia, "store.new", map[string]any{"id": "mine"})
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": personID(t, h, "mia@example.com"), "level": "view"})
	h.call(mia, "bind.set", map[string]any{"store": "mine", "alias": "contacts", "target": "crm", "prefix": "contacts"})
	h.fail(mia, "bind.set", map[string]any{"store": "mine", "alias": "contacts", "target": "crm", "prefix": "contacts", "level": "interact"}, "permission_denied")
	h.fail(mia, "bind.set", map[string]any{"store": "mine", "alias": "_contacts", "target": "crm", "prefix": "contacts"}, "invalid_argument")
	h.fail(mia, "bind.set", map[string]any{"store": "mine", "alias": "c", "target": "crm", "level": "view"}, "invalid_argument")
}

// A subscription through an alias follows the other store: its changes
// arrive at the page path, without a rev (the stream's cursor counts the
// page's own store), and a reconnected stream catches up.
func TestAliasStream(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "view"})
	pageApp(h, admin, "dash", "/dash", `{}`)
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})

	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/dash")
	sbx := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	auth := map[string]string{"Authorization": "Bearer " + v["secret"].(string)}
	if out := rpc(s, v, "db.subscribe", map[string]any{"sub": "s1", "path": "contacts", "coll": true}); out["result"] == nil {
		t.Fatalf("subscribe: %v", out)
	}
	stream, _ := s.do("GET", sbx, "/_rt/events", nil, auth)
	go func() {
		time.Sleep(200 * time.Millisecond)
		h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
		h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "deals/d1", "data": map[string]any{"x": 1}}) // not under the alias
	}()
	evs := events(t, stream, 2, 3*time.Second)
	stream.Body.Close()
	if len(evs) < 2 || evs[1]["_type"] != "doc" || evs[1]["path"] != "contacts/c1" || evs[1]["rev"] != nil {
		t.Fatalf("live remote change: %v", evs)
	}
	// While no stream is attached, crm changes; the next stream catches up.
	time.Sleep(100 * time.Millisecond)
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c2", "data": map[string]any{"name": "Bo"}})
	h.call(admin, "docs.rm", map[string]any{"store": "crm", "path": "contacts/c1"})
	stream, _ = s.do("GET", sbx, "/_rt/events?after=0", nil, auth)
	evs = events(t, stream, 3, 3*time.Second)
	stream.Body.Close()
	seen := map[string]bool{}
	for _, e := range evs[1:] {
		if e["_type"] == "doc" {
			seen[e["path"].(string)+map[bool]string{true: " deleted", false: ""}[e["deleted"] == true]] = true
		}
	}
	if !seen["contacts/c2"] || !seen["contacts/c1 deleted"] {
		t.Fatalf("catch-up after reconnect: %v", evs)
	}
}

// _stores/<id>/… opens to an app that declares db.stores once an admin
// allows it; registry documents are not served yet; another store's
// private documents are reachable by no route.
func TestStoresSpace(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "interact"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	pageApp(h, admin, "console", "/console", `{"stores":"view"}`)

	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/console")
	if out := rpc(s, v, "db.get", map[string]any{"path": "_stores/crm/contacts/c1"}); errCode(out) != "invalid_argument" {
		t.Fatalf("declared but not allowed: %v", out)
	}
	h.call(admin, "policy.set", map[string]any{"app": "console", "capability": "stores", "audience": "@guest", "value": "on"})
	v = guestView(t, s, "/console")
	d := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm/contacts/c1"}))
	if d["exists"] != true || d["path"] != "_stores/crm/contacts/c1" {
		t.Fatalf("_stores/crm/contacts/c1: %v", d)
	}
	docs := result(t, rpc(s, v, "db.query", map[string]any{"coll": "_stores/crm/contacts"}))["docs"].([]any)
	if len(docs) != 1 || docs[0].(map[string]any)["path"] != "_stores/crm/contacts/c1" {
		t.Fatalf("query under _stores: %v", docs)
	}
	// db.stores is view: no writes, whatever the guest holds on crm.
	if out := rpc(s, v, "db.write", map[string]any{"path": "_stores/crm/contacts/c9", "op": "set", "body": map[string]any{}}); errCode(out) != "invalid_argument" {
		t.Fatalf("write under a view _stores: %v", out)
	}
	// The registry's documents (phase 3) read as missing and empty.
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm"})); d["exists"] != false {
		t.Fatalf("_stores/crm: %v", d)
	}
	if docs := result(t, rpc(s, v, "db.query", map[string]any{"coll": "_stores"}))["docs"].([]any); len(docs) != 0 {
		t.Fatalf("_stores: %v", docs)
	}
	// Another store's private documents: missing, even for their owner.
	guest := v["user"].(string)
	st, _ := h.k.Store(context.Background(), "crm")
	if _, err := st.Do(context.Background(), store.Who{ID: guest, Via: "test"}, func(t *store.Turn) error {
		_, err := t.SetDoc("data/users/"+guest+"/prefs", map[string]any{"secret": 1}, 0)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm/data/users/" + guest + "/prefs"})); d["exists"] != false {
		t.Fatalf("another store's private document: %v", d)
	}
	// Depth: a store's 16-segment document is reachable at 18.
	deep := strings.TrimSuffix(strings.Repeat("a/1/", 8), "/")
	if out := rpc(s, v, "db.get", map[string]any{"path": "_stores/crm/" + deep}); out["result"] == nil {
		t.Fatalf("18 segments under _stores: %v", out)
	}
}

// A page shows an upload of a store its alias shares uploads with, by bare
// id; without --assets the id is unknown there.
func TestAliasAssets(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	pageApp(h, admin, "dash", "/dash", `{}`)
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})
	st, _ := h.k.Store(context.Background(), "crm")
	sum, n, err := st.Blobs.PutReader(bytes.NewReader([]byte("PNGBYTES")), 1<<20, "")
	if err != nil {
		t.Fatal(err)
	}
	id := "a0123456789abcdef0123456789abcdef"
	if _, err := st.Do(context.Background(), store.Who{ID: "admin", Via: "test"}, func(t *store.Turn) error {
		_, err := t.PutBlob("assets", id, sum, n, "image/png")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/dash")
	u, _ := url.Parse(v["url"].(string))
	blob := func() (int, string) {
		req, _ := http.NewRequest("GET", h.ts.URL+"/_blob/"+id, nil)
		req.Host = u.Host
		r, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer r.Body.Close()
		b, _ := io.ReadAll(r.Body)
		return r.StatusCode, string(b)
	}
	if code, _ := blob(); code != 404 {
		t.Fatalf("without --assets: %d", code)
	}
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts", "assets": true})
	if code, body := blob(); code != 200 || body != "PNGBYTES" {
		t.Fatalf("with --assets: %d %q", code, body)
	}
}

// Losing access to a store a page reads through an alias reopens the page,
// as losing access to its own store does: the documents it shows from
// there may be ones the viewer can no longer see.
func TestAliasRevokeReopens(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "view"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	pageApp(h, admin, "dash", "/dash", `{}`)
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})

	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/dash")
	sbx := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	if docs := result(t, rpc(s, v, "db.subscribe", map[string]any{"sub": "s1", "path": "contacts", "coll": true}))["docs"].([]any); len(docs) != 1 {
		t.Fatalf("subscribe: %v", docs)
	}
	stream, _ := s.do("GET", sbx, "/_rt/events", nil, map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	go func() {
		time.Sleep(200 * time.Millisecond)
		h.call(admin, "grant.rm", map[string]any{"store": "crm", "subject": "@guest"})
	}()
	evs := events(t, stream, 2, 3*time.Second)
	stream.Body.Close()
	if len(evs) < 2 || evs[1]["_type"] != "access" {
		t.Fatalf("after losing crm: %v", evs)
	}
	v = guestView(t, s, "/dash")
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"})); d["exists"] != false {
		t.Fatalf("the reopened page still reads crm: %v", d)
	}
}
