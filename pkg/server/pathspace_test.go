package server

// Tests for SLOP3-008 phase 1: one path space per page (aliases into other
// stores, _stores/<id>/…), with their documents, changes and uploads.

import (
	"bytes"
	"context"
	"encoding/base64"
	"io"
	"maps"
	"net/http"
	"net/url"
	"strconv"
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

// A reconnected stream resumes another store from what the runtime says it
// received (?remote=key:rev), not from what the server wrote: a change the
// connection accepted but the browser never got comes again (review of
// PR #20).
func TestAliasResumeFromClientCursor(t *testing.T) {
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
	rpc(s, v, "db.subscribe", map[string]any{"sub": "s1", "path": "contacts", "coll": true})
	docsOf := func(evs []map[string]any) []string {
		var out []string
		for _, e := range evs {
			if e["_type"] == "doc" {
				out = append(out, e["path"].(string))
			}
		}
		return out
	}
	// The server writes c1 to the stream; the browser is taken to have lost it.
	stream, _ := s.do("GET", sbx, "/_rt/events", nil, auth)
	go func() {
		time.Sleep(200 * time.Millisecond)
		h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	}()
	evs := events(t, stream, 2, 3*time.Second)
	if len(evs) < 2 || evs[1]["remote"] == nil || evs[1]["remoteRev"] == nil || evs[1]["rev"] != nil {
		t.Fatalf("live remote change: %v", evs)
	}
	key, rev := evs[1]["remote"].(string), int64(evs[1]["remoteRev"].(float64))
	time.Sleep(100 * time.Millisecond)
	// Reconnect without having confirmed c1: it comes again.
	stream, _ = s.do("GET", sbx, "/_rt/events?after=0", nil, auth)
	if got := docsOf(events(t, stream, 2, time.Second)); len(got) != 1 || got[0] != "contacts/c1" {
		t.Fatalf("resume without a remote cursor: %v", got)
	}
	time.Sleep(100 * time.Millisecond)
	// Reconnect having confirmed c1: only what came after it.
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c2", "data": map[string]any{"name": "Bo"}})
	stream, _ = s.do("GET", sbx, "/_rt/events?after=0&remote="+key+":"+strconv.FormatInt(rev, 10), nil, auth)
	if got := docsOf(events(t, stream, 3, time.Second)); len(got) != 1 || got[0] != "contacts/c2" {
		t.Fatalf("resume from the confirmed cursor: %v", got)
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
	// The registry (phase 3): the guest reads crm's row, at its level there.
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm"})); d["exists"] != true || d["body"].(map[string]any)["level"] != "view" {
		t.Fatalf("_stores/crm: %v", d)
	}
	if docs := result(t, rpc(s, v, "db.query", map[string]any{"coll": "_stores"}))["docs"].([]any); len(docs) != 2 { // crm and console's own
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

// A page that subscribed to an alias before its viewer could read the
// target is reopened when a grant there arrives, as a revoke reopens it
// (review of PR #20): the subscription follows the store at no level.
func TestAliasGrantReopens(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	pageApp(h, admin, "dash", "/dash", `{}`)
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})

	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/dash")
	sbx := strings.TrimPrefix(strings.Split(v["url"].(string), "/v/")[0], "http://")
	if docs := result(t, rpc(s, v, "db.subscribe", map[string]any{"sub": "s1", "path": "contacts", "coll": true}))["docs"].([]any); len(docs) != 0 {
		t.Fatalf("subscribe without a grant on crm: %v", docs)
	}
	stream, _ := s.do("GET", sbx, "/_rt/events", nil, map[string]string{"Authorization": "Bearer " + v["secret"].(string)})
	go func() {
		time.Sleep(200 * time.Millisecond)
		h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "view"})
	}()
	evs := events(t, stream, 2, 3*time.Second)
	stream.Body.Close()
	if len(evs) < 2 || evs[1]["_type"] != "access" {
		t.Fatalf("after gaining crm: %v", evs)
	}
	v = guestView(t, s, "/dash")
	if docs := result(t, rpc(s, v, "db.subscribe", map[string]any{"sub": "s1", "path": "contacts", "coll": true}))["docs"].([]any); len(docs) != 1 {
		t.Fatalf("the reopened page does not read crm: %v", docs)
	}
}

// pushApp pushes files into a new store and mounts it at path for guests.
func pushApp(h *harness, admin, storeID, path string, fs map[string]string) {
	h.t.Helper()
	h.call(admin, "store.new", map[string]any{"id": storeID})
	h.call(admin, "files.push", map[string]any{"store": storeID, "files": files(fs)})
	if path != "" {
		h.call(admin, "mount.set", map[string]any{"host": h.cfg.Hosts.Live[0], "path": path, "store": storeID})
		h.call(admin, "grant.set", map[string]any{"store": storeID, "subject": "@guest", "level": "interact"})
	}
}

// The contract's files capability reads a store's main snapshot as the
// viewer: through an alias, or every store under _stores (phase 2).
func TestFilesCapability(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	pushApp(h, admin, "crm", "", map[string]string{
		"app.json":       `{"title":"CRM","capabilities":{"db":{}}}`,
		"index.html":     `<!doctype html><title>crm</title>`,
		"src/a.js":       `console.log("a")`,
		"src/lib/b.js":   `export const b = 1`,
		"docs/readme.md": "# CRM",
	})
	page := `<!doctype html><title>p</title>`
	pushApp(h, admin, "viewer", "/viewer", map[string]string{"app.json": `{"title":"v","capabilities":{"files":{"project":"source"}}}`, "index.html": page})
	h.call(admin, "bind.set", map[string]any{"store": "viewer", "alias": "source", "target": "crm"})

	s := h.site(h.cfg.Hosts.Live[0])
	v := guestView(t, s, "/viewer")
	if out := rpc(s, v, "files.list", map[string]any{}); errCode(out) != "not_found" {
		t.Fatalf("without a grant on crm: %v", out)
	}
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "view"})
	names := func(out map[string]any) []string {
		var n []string
		for _, e := range result(t, out)["entries"].([]any) {
			m := e.(map[string]any)
			p := m["path"].(string)
			if m["isDirectory"] == true {
				p += "/"
			}
			n = append(n, p)
		}
		return n
	}
	if got := strings.Join(names(rpc(s, v, "files.list", map[string]any{})), " "); got != "app.json docs/ index.html src/" {
		t.Fatalf("top level: %s", got)
	}
	if got := strings.Join(names(rpc(s, v, "files.list", map[string]any{"path": "src"})), " "); got != "src/a.js src/lib/" {
		t.Fatalf("src: %s", got)
	}
	if got := strings.Join(names(rpc(s, v, "files.list", map[string]any{"path": "src", "recursive": true})), " "); got != "src/a.js src/lib/ src/lib/b.js" {
		t.Fatalf("src, recursive: %s", got)
	}
	r := result(t, rpc(s, v, "files.read", map[string]any{"path": "src/a.js", "offset": 8, "length": 3}))
	if b, _ := base64.StdEncoding.DecodeString(r["bytes"].(string)); string(b) != `log` || r["size"].(float64) != 16 || len(r["revision"].(string)) != 64 {
		t.Fatalf("read: %v", r)
	}
	for _, c := range []struct{ method, path, code string }{
		{"files.read", "src", "bad_request"}, {"files.list", "src/a.js", "bad_request"},
		{"files.read", "nope.js", "not_found"}, {"files.list", "nope", "not_found"},
	} {
		if out := rpc(s, v, c.method, map[string]any{"path": c.path}); errCode(out) != c.code {
			t.Fatalf("%s %s: %v", c.method, c.path, out)
		}
	}

	// _stores: every store the viewer may open, as folders.
	pushApp(h, admin, "console", "/console", map[string]string{"app.json": `{"title":"c","capabilities":{"db":{"stores":"view"},"files":{"project":"_stores"}}}`, "index.html": page})
	if code, v := openView(s, s.host, "/console", ""); code != 200 || v["caps"].(map[string]any)["files"] != nil {
		t.Fatalf("files over _stores before the policy allows _stores: %d %v", code, v["caps"])
	}
	h.call(admin, "policy.set", map[string]any{"app": "console", "capability": "stores", "audience": "@guest", "value": "on"})
	v = guestView(t, s, "/console")
	top := strings.Join(names(rpc(s, v, "files.list", map[string]any{})), " ")
	if !strings.Contains(top, "crm/") || strings.Contains(top, "nope") {
		t.Fatalf("_stores top level: %s", top)
	}
	r = result(t, rpc(s, v, "files.read", map[string]any{"path": "crm/docs/readme.md"}))
	if b, _ := base64.StdEncoding.DecodeString(r["bytes"].(string)); string(b) != "# CRM" {
		t.Fatalf("read under _stores: %v", r)
	}
}

// An empty project lists as an empty array, not null: the runtime maps over
// entries (review of PR #20).
func TestFilesListEmpty(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "blank"})
	h.call(admin, "grant.set", map[string]any{"store": "blank", "subject": "@guest", "level": "view"})
	pushApp(h, admin, "viewer", "/viewer", map[string]string{"app.json": `{"title":"v","capabilities":{"files":{"project":"source"}}}`, "index.html": `<!doctype html><title>p</title>`})
	h.call(admin, "bind.set", map[string]any{"store": "viewer", "alias": "source", "target": "blank"})
	s := h.site(h.cfg.Hosts.Live[0])
	out := rpc(s, guestView(t, s, "/viewer"), "files.list", map[string]any{})
	if e, ok := result(t, out)["entries"].([]any); !ok || len(e) != 0 {
		t.Fatalf("empty project: %v", out)
	}
}

// adminView signs admin@example.com in on the live host and opens the page
// mounted at path.
func adminView(t *testing.T, h *harness, path string) (*site, map[string]any) {
	t.Helper()
	live := h.cfg.Hosts.Live[0]
	b := h.browser()
	b.signIn("admin@example.com")
	s := h.site(live)
	signInSite(t, h, s, b, live, path)
	return s, guestView(t, s, path)
}

// The registry as documents (phase 3): an app allowed _stores reads stores,
// grants, aliases and people as documents, and changes grants, aliases, a
// store's type and a person's role by writing them, through the verbs that
// own them, as the person, after they confirm, honouring ifVersion.
func TestRegistryDocuments(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": "@guest", "level": "view"})
	pushApp(h, admin, "console", "/console", map[string]string{"app.json": `{"title":"c","capabilities":{"db":{"stores":"admin"}}}`, "index.html": `<!doctype html><title>c</title>`})
	h.call(admin, "policy.set", map[string]any{"app": "console", "capability": "stores", "audience": "@admin", "value": "on"})
	h.call(admin, "policy.set", map[string]any{"app": "console", "capability": "stores", "audience": "@guest", "value": "on"})

	s, v := adminView(t, h, "/console")
	ids := func(out map[string]any) []string {
		var n []string
		for _, d := range result(t, out)["docs"].([]any) {
			n = append(n, d.(map[string]any)["path"].(string))
		}
		return n
	}
	if got := strings.Join(ids(rpc(s, v, "db.query", map[string]any{"coll": "_stores"})), " "); !strings.Contains(got, "_stores/crm") || !strings.Contains(got, "_stores/console") {
		t.Fatalf("_stores: %s", got)
	}
	row := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm"}))
	if row["exists"] != true || row["body"].(map[string]any)["level"] != "admin" {
		t.Fatalf("_stores/crm: %v", row)
	}
	if got := ids(rpc(s, v, "db.query", map[string]any{"coll": "_stores/crm/_grants"})); strings.Join(got, " ") != "_stores/crm/_grants/@guest" {
		t.Fatalf("grants: %v", got)
	}
	g := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm/_grants/@guest"}))
	version := int64(g["version"].(float64))

	// A write asks the person first, then runs grant.set as them.
	write := map[string]any{"path": "_stores/crm/_grants/@member", "op": "set", "body": map[string]any{"level": "interact"}}
	out := rpc(s, v, "db.write", write)
	if errCode(out) != "confirmation_required" {
		t.Fatalf("a registry write without confirmation: %v", out)
	}
	h.call(admin, "confirm.approve", map[string]any{"id": out["error"].(map[string]any)["confirm"]})
	if out := rpc(s, v, "db.write", write); out["result"] == nil {
		t.Fatalf("the confirmed write: %v", out)
	}
	grants := h.call(admin, "grant.ls", map[string]any{"store": "crm"}).([]any)
	if len(grants) != 2 {
		t.Fatalf("crm grants after the write: %v", grants)
	}
	// ifVersion: a stale version is a conflict, and nothing is asked.
	if out := rpc(s, v, "db.write", map[string]any{"path": "_stores/crm/_grants/@guest", "op": "set", "body": map[string]any{"level": "interact"}, "ifVersion": version - 1}); errCode(out) != "conflict" {
		t.Fatalf("stale ifVersion: %v", out)
	}
	// Fields a verb does not take are refused; read-only documents too.
	if out := rpc(s, v, "db.write", map[string]any{"path": "_stores/crm", "op": "update", "body": map[string]any{"owner": "x"}}); errCode(out) != "invalid_argument" {
		t.Fatalf("writing a store's owner: %v", out)
	}
	if out := rpc(s, v, "db.write", map[string]any{"path": "_stores/crm/_llm/budget", "op": "set", "body": map[string]any{}}); errCode(out) != "invalid_argument" {
		t.Fatalf("writing the LLM budget: %v", out)
	}
	// People are listed for platform admins, and read-only.
	people := ids(rpc(s, v, "db.query", map[string]any{"coll": "_people"}))
	if len(people) == 0 || !strings.HasPrefix(people[0], "_people/usr_") {
		t.Fatalf("_people: %v", people)
	}
	if out := rpc(s, v, "db.write", map[string]any{"path": people[0], "op": "update", "body": map[string]any{"role": "admin"}}); errCode(out) != "invalid_argument" {
		t.Fatalf("writing a person's role: %v", out)
	}

	// A guest sees the stores it may open, but not their grants (grant.ls
	// needs admin there), and cannot write the registry.
	gs := h.site(h.cfg.Hosts.Live[0])
	gv := guestView(t, gs, "/console")
	if got := ids(rpc(gs, gv, "db.query", map[string]any{"coll": "_stores/crm/_grants"})); len(got) != 0 {
		t.Fatalf("a guest reads crm's grants: %v", got)
	}
	if got := ids(rpc(gs, gv, "db.query", map[string]any{"coll": "_people"})); len(got) != 0 {
		t.Fatalf("a guest lists people: %v", got)
	}
	if d := result(t, rpc(gs, gv, "db.get", map[string]any{"path": "_stores/crm"})); d["exists"] != true || d["body"].(map[string]any)["level"] != "view" {
		t.Fatalf("a guest's _stores/crm: %v", d)
	}
}

// Registry writes need capabilities.db.stores "admin".
func TestRegistryWritesNeedAdminStores(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	pushApp(h, admin, "viewer", "/viewer", map[string]string{"app.json": `{"title":"v","capabilities":{"db":{"stores":"view"}}}`, "index.html": `<!doctype html><title>v</title>`})
	h.call(admin, "policy.set", map[string]any{"app": "viewer", "capability": "stores", "audience": "@admin", "value": "on"})
	s, v := adminView(t, h, "/viewer")
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "_stores/crm"})); d["exists"] != true {
		t.Fatalf("read with stores view: %v", d)
	}
	if out := rpc(s, v, "db.write", map[string]any{"path": "_stores/crm/_grants/@member", "op": "set", "body": map[string]any{"level": "view"}}); errCode(out) != "invalid_argument" {
		t.Fatalf("a registry write with stores view: %v", out)
	}
}

// Alias templates on mounts (phase 4): a mount that creates stores binds
// each one it creates as its template says, so the new page reads its
// aliases from the start; the template is checked as bind.set checks a
// binding, and mount.undo restores it with the rest of the mount.
func TestMountAliasTemplate(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	live := h.cfg.Hosts.Live[0]
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	h.call(admin, "store.new", map[string]any{"id": "dash"})
	h.call(admin, "files.push", map[string]any{"store": "dash", "files": files(map[string]string{
		"app.json":   `{"title":"d","type":"dashboard","capabilities":{"db":{}}}`,
		"index.html": `<!doctype html><title>d</title>`,
	})})
	tmpl := []any{map[string]any{"alias": "contacts", "target": "crm", "prefix": "contacts", "level": "view"}}
	mount := map[string]any{"host": live, "path": "/d/:id", "storeParam": "id", "createApp": "dash", "aliases": tmpl}

	for _, bad := range map[string][]any{
		"a level above admin": {map[string]any{"alias": "contacts", "target": "crm", "prefix": "contacts", "level": "owner"}},
		"a reserved alias":    {map[string]any{"alias": "_stores", "target": "crm", "prefix": "contacts"}},
		"an unknown field":    {map[string]any{"alias": "contacts", "target": "crm", "prefix": "contacts", "to": "x"}},
		"twice":               {tmpl[0], tmpl[0]},
	} {
		m := maps.Clone(mount)
		m["aliases"] = bad
		h.fail(admin, "mount.set", m, "invalid_argument")
	}
	h.fail(admin, "mount.set", map[string]any{"host": live, "path": "/x", "store": "dash", "aliases": tmpl}, "invalid_argument")
	h.fail(admin, "mount.set", map[string]any{"host": live, "path": "/d/:id", "storeParam": "id", "createApp": "dash",
		"aliases": []any{map[string]any{"alias": "contacts", "target": "nope", "prefix": "contacts"}}}, "not_found")

	h.call(admin, "mount.set", mount)
	ms := h.call(admin, "mount.ls", map[string]any{"host": live}).([]any)
	if got := ms[0].(map[string]any)["mount"].(map[string]any)["aliases"]; got == nil {
		t.Fatalf("mount.ls: %v", ms)
	}

	// A signed-in member creates a dashboard at /d/…; it comes bound.
	s, b := h.site(live), h.browser()
	b.signIn("admin@example.com")
	signInSite(t, h, s, b, live, "/d/new")
	r, out := s.do("POST", live, "/_site/create", map[string]any{"path": "/d/new"}, nil)
	if r.StatusCode != 201 {
		t.Fatalf("create: %d %v", r.StatusCode, out)
	}
	id := out["store"].(string)
	bs := h.call(admin, "bind.ls", map[string]any{"store": id}).([]any)
	if len(bs) != 1 || bs[0].(map[string]any)["prefix"] != "contacts" || bs[0].(map[string]any)["level"] != "view" {
		t.Fatalf("the new store's bindings: %v", bs)
	}
	v := guestView(t, s, out["path"].(string))
	if d := result(t, rpc(s, v, "db.get", map[string]any{"path": "contacts/c1"})); d["exists"] != true {
		t.Fatalf("the new page reads crm: %v", d)
	}

	// Replacing the mount drops the template; undo brings it back.
	delete(mount, "aliases")
	h.call(admin, "mount.set", mount)
	h.call(admin, "mount.undo", map[string]any{"host": live, "path": "/d/:id"})
	ms = h.call(admin, "mount.ls", map[string]any{"host": live}).([]any)
	if got := ms[0].(map[string]any)["mount"].(map[string]any)["aliases"].([]any); len(got) != 1 {
		t.Fatalf("after undo: %v", ms)
	}
}
