package host

import (
	"testing"
)

// dbActor reads and writes through use('db'): its own store, an alias, an
// alias of itself, and _stores.
const dbActor = `const db = use('db');
defineActor({ actions: {
  read: { requires: 'interact', run(ctx) {
    const c = db.doc('contacts/c1').get();
    const q = db.collection('contacts').get();
    const own = db.doc('notes/n1').get();
    const mine = db.doc('self/n1').get();
    const mineQ = db.collection('self').get();
    return { c: c.exists ? c.data().name : null, cPath: c.path, n: q.size, qPath: q.empty ? null : q.docs[0].path,
             own: own.exists, mine: mine.exists, minePath: mineQ.empty ? null : mineQ.docs[0].path };
  } },
  stores: { requires: 'interact', run(ctx) {
    const d = db.doc('_stores/crm/contacts/c1').get();
    const row = db.doc('_stores/crm').get();
    return { d: d.exists, row: row.exists ? row.data().level : null, n: db.collection('_stores/crm/contacts').get().size };
  } },
  writeOwn: { run(ctx) { return db.doc('notes/n1').set({ t: 1 }); } },
  writeSelfAlias: { run(ctx) { return db.doc('self/n2').set({ t: 2 }); } },
  writeAlias: { run(ctx) { return db.doc('contacts/c9').set({ name: 'Bo' }); } },
  writeStores: { run(ctx) { return db.doc('_stores/crm/contacts/c9').set({}); } },
} });`

// An actor's use('db') sees its store's path space (SLOP3-009 step 4): an
// alias reads the other store as the event's visitor, _stores is open when
// the app declares it and the policy allows it for the visitor, an alias of
// the store itself is the store's own, and writes outside the store are
// refused.
func TestActorDBPathSpace(t *testing.T) {
	h := newHarness(t)
	admin := h.tokenFor("admin@example.com", "read", "write", "admin")
	mia := h.tokenFor("mia@example.com", "read", "write")
	h.call(admin, "store.new", map[string]any{"id": "crm"})
	h.call(admin, "docs.set", map[string]any{"store": "crm", "path": "contacts/c1", "data": map[string]any{"name": "Ada"}})
	pushApp(h, admin, "dash", "", map[string]string{
		"app.json": `{"title":"d","actor":"actor.js","capabilities":{"db":{"stores":"view"}}}`,
		"actor.js": dbActor,
	})
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "contacts", "target": "crm", "prefix": "contacts"})
	h.call(admin, "bind.set", map[string]any{"store": "dash", "alias": "self", "target": "dash", "prefix": "notes"})
	h.call(admin, "grant.set", map[string]any{"store": "dash", "subject": personID(t, h, "mia@example.com"), "level": "interact"})
	call := func(tok, action string) map[string]any {
		t.Helper()
		out, _ := h.call(tok, "actor.call", map[string]any{"store": "dash", "action": action, "args": map[string]any{}}).(map[string]any)
		return out
	}

	// Own writes stay in the turn; an alias of the store itself is its own.
	call(admin, "writeOwn")
	call(admin, "writeSelfAlias")
	got := call(admin, "read")
	if got["c"] != "Ada" || got["cPath"] != "contacts/c1" || got["n"] != 1.0 || got["qPath"] != "contacts/c1" ||
		got["own"] != true || got["mine"] != true || got["minePath"] == nil {
		t.Fatalf("admin reads: %v", got)
	}
	if p := got["minePath"].(string); p != "self/n1" && p != "self/n2" {
		t.Fatalf("self alias query path: %v", p)
	}

	// Mia holds nothing on crm: the alias shows her nothing.
	if got := call(mia, "read"); got["c"] != nil || got["n"] != 0.0 || got["own"] != true {
		t.Fatalf("mia reads: %v", got)
	}
	h.call(admin, "grant.set", map[string]any{"store": "crm", "subject": personID(t, h, "mia@example.com"), "level": "view"})
	if got := call(mia, "read"); got["c"] != "Ada" {
		t.Fatalf("mia reads after a grant on crm: %v", got)
	}

	// Writes outside the store: refused, whatever the visitor holds there.
	h.fail(admin, "actor.call", map[string]any{"store": "dash", "action": "writeAlias", "args": map[string]any{}}, "permission_denied")

	// _stores: closed until the policy allows it for the visitor.
	h.fail(admin, "actor.call", map[string]any{"store": "dash", "action": "stores", "args": map[string]any{}}, "invalid_argument")
	h.call(admin, "policy.set", map[string]any{"app": "dash", "capability": "stores", "audience": "@admin", "value": "on"})
	if got := call(admin, "stores"); got["d"] != true || got["row"] != "view" || got["n"] != 1.0 {
		t.Fatalf("admin _stores: %v", got)
	}
	h.fail(admin, "actor.call", map[string]any{"store": "dash", "action": "writeStores", "args": map[string]any{}}, "permission_denied")
	h.fail(mia, "actor.call", map[string]any{"store": "dash", "action": "stores", "args": map[string]any{}}, "invalid_argument")
}
